// Offline roof analysis — OWNED by Dev D
// Run: pnpm bake:analyze
//
// Input  : public/baked/{house}-photogrammetry.glb (output of fetch-3d-tiles.ts)
//          (falls back to public/models/{house}.glb if photogrammetry missing)
// Output : public/baked/{house}-analysis.json
//          {
//            houseId,
//            faces[]        — id, normal, area, azimuth, tilt, vertices, yieldKwhPerSqm
//            obstructions[] — id, type, position, radius
//            modulePositions[] — placed via place-panels.ts
//            buildingFootprint  — bbox (center, size) of building geometry
//          }
//
// Pipeline:
//   1. Load GLB via @gltf-transform/core.
//   2. Walk all primitives → extract triangles + per-triangle normals + centroids.
//   3. Skip triangles with normal.y < 0.15 (floor / walls).
//   4. DBSCAN on (normal_x, normal_z) — separates south/north/east/west pitches.
//   5. For each cluster: compute mean normal, area (Σ tri area), azimuth, tilt,
//      and a 2D convex hull for vertex polygon (in world coords).
//   6. Yield = baseline 1100 kWh/m² × cos(deviation from optimal) (cheap).
//   7. Footprint = AABB of all triangles whose centroid is above ground threshold.
//   8. Modules placed via placePanelsOnFace per face.
//
// CRITICAL: this is the project's #1 risk. Checkpoint Sat 17:00.
// If DBSCAN doesn't yield clean planes → Plan B is in-place (the existing JSON
// mocks already keep Dev A and Dev B unblocked).

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { RoofFace, Obstruction, RoofGeometry } from '../lib/types';
import { placePanelsOnFace } from './place-panels';

const HOUSES = ['brandenburg', 'hamburg', 'ruhr'] as const;

const BAKED_DIR = path.join(process.cwd(), 'public/baked');
const FALLBACK_DIR = path.join(process.cwd(), 'public/models');

const ROOF_NORMAL_Y_MIN = 0.15;
const DBSCAN_EPS = 0.12;
const DBSCAN_MIN_POINTS = 12;
// Roof-face cluster threshold: small buildings can yield meshes with as few as
// 3-4 triangles per pitch (low-LOD photogrammetry). The summed-area threshold
// (MIN_FACE_AREA_SQM) handles noise rejection — point count just needs to be
// non-trivial.
const FACE_MIN_POINTS = 2;
const MIN_FACE_AREA_SQM = 0.5;
const BASELINE_YIELD_KWH_PER_SQM = 1100;
const OPTIMAL_TILT_DEG = 35;
const OPTIMAL_AZIMUTH_DEG = 180;
// In ENU-local frame, origin = the address. Used as a FALLBACK when the
// OSM building polygon is not available — keep only triangles within this
// horizontal radius so we don't analyse the whole neighbourhood.
const HOUSE_HORIZONTAL_RADIUS_M = 15;
// Overpass: search for OSM buildings within this radius around the address.
const OSM_SEARCH_RADIUS_M = 30;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// WGS84 equatorial radius (m). Good enough for small-scale lat/lng → meters
// conversion at city scale (sub-metre error on ~100 m baselines).
const EARTH_RADIUS_M = 6378137;

// Obstruction detection
const OBSTRUCTION_MIN_HEIGHT_M = 0.15;     // raised this much above the face plane → candidate
const OBSTRUCTION_MAX_HEIGHT_M = 2.5;      // ignore anything taller (likely a neighbour, not a roof obstacle)
const OBSTRUCTION_DBSCAN_EPS_M = 0.4;      // spatial clustering radius
const OBSTRUCTION_DBSCAN_MIN_POINTS = 4;
const OBSTRUCTION_SAFETY_MARGIN_M = 0.3;   // panels must keep this clear around any obstacle
const OBSTRUCTION_MIN_RADIUS_M = 0.2;      // floor radius (very small bumps are still no-go zones)

interface Triangle {
  centroid: [number, number, number];
  normal: [number, number, number];
  area: number;
  vertices: [number, number, number][];
}

function buildTrianglesFromArrays(positions: ArrayLike<number>, indices: ArrayLike<number>): Triangle[] {
  const triangles: Triangle[] = [];
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    const v0: [number, number, number] = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const v1: [number, number, number] = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const v2: [number, number, number] = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

    const ax = v1[0] - v0[0];
    const ay = v1[1] - v0[1];
    const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0];
    const by = v2[1] - v0[1];
    const bz = v2[2] - v0[2];

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-8) continue;

    const area = len * 0.5;
    const normal: [number, number, number] = [cx / len, cy / len, cz / len];
    const centroid: [number, number, number] = [
      (v0[0] + v1[0] + v2[0]) / 3,
      (v0[1] + v1[1] + v2[1]) / 3,
      (v0[2] + v1[2] + v2[2]) / 3,
    ];
    triangles.push({ centroid, normal, area, vertices: [v0, v1, v2] });
  }
  return triangles;
}

async function loadTrianglesFromJson(jsonPath: string): Promise<{ triangles: Triangle[]; origin: LatLng | null }> {
  const raw = await fs.readFile(jsonPath, 'utf-8');
  const data = JSON.parse(raw) as { positions: number[]; indices: number[]; lat?: number; lng?: number };
  const triangles = buildTrianglesFromArrays(data.positions, data.indices);
  const origin = typeof data.lat === 'number' && typeof data.lng === 'number' ? { lat: data.lat, lng: data.lng } : null;
  return { triangles, origin };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function sortedClustersIsEmptyHint(
  significant: number[][],
  all: number[][],
  roofTris: Triangle[],
): boolean {
  // Show diagnostic when nothing significant survived but the raw clustering
  // produced something. Helps debug "0 faces" results on small buildings.
  if (significant.length > 0) return false;
  return all.some((c) => c.length >= 3 && c.reduce((s, i) => s + roofTris[i].area, 0) > 0.1);
}

// ─── OSM building footprint (Overpass API) ────────────────────────────────
//
// Goal: replace the naive 15-m radius filter with the actual building polygon
// from the German cadastre (OpenStreetMap). Solves the "mitoyennes / Reihenhäuser"
// problem: only triangles inside THIS building's polygon are kept, even if a
// neighbour shares a wall.

interface LatLng {
  lat: number;
  lng: number;
}

/** Project a (lat, lng) point into the local Y-up frame (X=East, Z=South, in metres). */
function latLngToLocalXZ(point: LatLng, origin: LatLng): { x: number; z: number } {
  const lat0Rad = (origin.lat * Math.PI) / 180;
  const dLat = ((point.lat - origin.lat) * Math.PI) / 180;
  const dLng = ((point.lng - origin.lng) * Math.PI) / 180;
  return {
    x: dLng * Math.cos(lat0Rad) * EARTH_RADIUS_M, // East
    z: -dLat * EARTH_RADIUS_M, // South (Y-up convention: -North)
  };
}

interface OverpassWay {
  type: 'way';
  id: number;
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
interface OverpassResp {
  elements: OverpassWay[];
}

/**
 * Query Overpass for buildings around a lat/lng, return the polygon (in local
 * frame) of the building that CONTAINS the address. Null if Overpass fails or
 * no building matches — caller falls back to the radius filter.
 */
async function fetchBuildingPolygon(origin: LatLng): Promise<{ x: number; z: number }[] | null> {
  const query = `[out:json][timeout:10];way["building"](around:${OSM_SEARCH_RADIUS_M},${origin.lat},${origin.lng});out geom;`;
  let resp: Response;
  try {
    resp = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'text/plain',
        // Overpass returns 406 if no User-Agent is set.
        'User-Agent': 'reonic-hackathon-roof-analyser/0.1 (https://github.com/jolehuit/reonic-hackathon)',
      },
    });
  } catch (err) {
    console.warn('  OSM fetch failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
  if (!resp.ok) {
    console.warn(`  OSM responded ${resp.status} ${resp.statusText}`);
    return null;
  }
  const data = (await resp.json()) as OverpassResp;
  if (!data.elements?.length) {
    console.warn('  OSM: no buildings within ' + OSM_SEARCH_RADIUS_M + ' m of the address');
    return null;
  }

  // Find the building whose polygon (in lat/lng) contains the origin.
  // Fall back to the closest building if none contain the exact point.
  let best: { way: OverpassWay; localPoly: { x: number; z: number }[]; dist: number } | null = null;
  for (const way of data.elements) {
    if (!way.geometry?.length) continue;
    const localPoly = way.geometry.map((g) => latLngToLocalXZ({ lat: g.lat, lng: g.lon }, origin));
    if (pointInPolygonXZ(localPoly, 0, 0)) {
      return localPoly; // origin is inside this building → done
    }
    // Distance from origin to polygon centroid (cheap proxy).
    const cx = localPoly.reduce((s, p) => s + p.x, 0) / localPoly.length;
    const cz = localPoly.reduce((s, p) => s + p.z, 0) / localPoly.length;
    const dist = Math.hypot(cx, cz);
    if (!best || dist < best.dist) best = { way, localPoly, dist };
  }
  if (best && best.dist < 15) {
    console.warn(`  OSM: address not inside any polygon, using closest building (${best.dist.toFixed(1)} m away, OSM way ${best.way.id})`);
    return best.localPoly;
  }
  return null;
}

async function loadTriangles(glbPath: string): Promise<Triangle[]> {
  // Lazy import — avoids hard dependency at parse time.
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const doc = await io.read(glbPath);

  const triangles: Triangle[] = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const positions = prim.getAttribute('POSITION')?.getArray();
      const indices = prim.getIndices()?.getArray();
      if (!positions) continue;
      const indexArray = indices ?? Array.from({ length: positions.length / 3 }, (_, i) => i);
      triangles.push(...buildTrianglesFromArrays(positions, indexArray));
    }
  }
  return triangles;
}

/**
 * Bucket triangles by their normal direction in a 2D grid (nx, nz).
 * Triangles whose horizontal-normal lands in the same cell point in the
 * same direction → same roof pitch. Equivalent to a DBSCAN result but in
 * O(n) instead of O(n²) — required for photogrammetric meshes with 10k+ tris.
 */
function clusterRoofFaces(triangles: Triangle[]): number[][] {
  const GRID_RES = 10; // 10 × 10 buckets covering nx,nz ∈ [-1, 1]
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < triangles.length; i++) {
    const n = triangles[i].normal;
    const cx = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((n[0] + 1) / 2) * GRID_RES)));
    const cz = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((n[2] + 1) / 2) * GRID_RES)));
    const key = cx * GRID_RES + cz;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(i);
  }
  return [...buckets.values()];
}

function meanNormal(tris: Triangle[]): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let totalArea = 0;
  for (const t of tris) {
    nx += t.normal[0] * t.area;
    ny += t.normal[1] * t.area;
    nz += t.normal[2] * t.area;
    totalArea += t.area;
  }
  if (totalArea === 0) return [0, 1, 0];
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function azimuthFromNormal(n: [number, number, number]): number {
  // Azimuth: 0° = North, clockwise. North = +Z, East = +X.
  const deg = (Math.atan2(n[0], n[2]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function tiltFromNormal(n: [number, number, number]): number {
  const up = Math.max(-1, Math.min(1, n[1]));
  return (Math.acos(up) * 180) / Math.PI;
}

function convexHullXZ(points: [number, number, number][]): [number, number, number][] {
  // Andrew's monotone chain in the XZ plane. Y is averaged.
  if (points.length < 3) return points;
  const avgY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[2] - b[2] : a[0] - b[0]));

  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]);

  const lower: [number, number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((p) => [p[0], avgY, p[2]] as [number, number, number]);
}

function computeYield(azimuth: number, tilt: number): number {
  const azDelta = Math.min(Math.abs(azimuth - OPTIMAL_AZIMUTH_DEG), 360 - Math.abs(azimuth - OPTIMAL_AZIMUTH_DEG));
  const tiltDelta = Math.abs(tilt - OPTIMAL_TILT_DEG);
  const azFactor = Math.cos((azDelta * Math.PI) / 180);
  const tiltFactor = Math.cos((tiltDelta * Math.PI) / 180);
  const factor = Math.max(0.45, 0.6 + 0.2 * azFactor + 0.2 * tiltFactor);
  return Math.round(BASELINE_YIELD_KWH_PER_SQM * factor);
}

interface FacePlane {
  faceId: number;
  point: [number, number, number]; // any point on the plane
  normal: [number, number, number];
  hull2D: { x: number; z: number }[]; // XZ outline of the face
}

function buildFacePlane(face: RoofFace): FacePlane {
  return {
    faceId: face.id,
    point: face.vertices[0] as [number, number, number],
    normal: face.normal,
    hull2D: face.vertices.map((v) => ({ x: v[0], z: v[2] })),
  };
}

function signedDistanceToPlane(p: [number, number, number], plane: FacePlane): number {
  const dx = p[0] - plane.point[0];
  const dy = p[1] - plane.point[1];
  const dz = p[2] - plane.point[2];
  return dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2];
}

function pointInPolygonXZ(polygon: { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.z > z !== pj.z > z &&
      x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyObstruction(radius: number, heightSpread: number): Obstruction['type'] {
  // Heuristic — chimneys are tall + narrow, dormers are wider, vents are tiny.
  if (radius < 0.35) return 'vent';
  if (heightSpread > 0.8 || radius > 0.7) return 'dormer';
  return 'chimney';
}

async function detectObstructions(
  allTriangles: Triangle[],
  assignedToFace: Set<number>,
  facePlanes: FacePlane[],
): Promise<{ obstructions: Obstruction[]; coverByFace: Map<number, number> }> {
  if (facePlanes.length === 0) {
    return { obstructions: [], coverByFace: new Map() };
  }
  const { DBSCAN } = await import('density-clustering');

  // Candidates: triangles NOT in any roof face, sitting just above some face's plane,
  // and whose XZ centroid falls inside that face's outline.
  type Candidate = {
    centroid: [number, number, number];
    triIdx: number;
    faceId: number;
    height: number;
  };
  const candidates: Candidate[] = [];

  for (let i = 0; i < allTriangles.length; i++) {
    if (assignedToFace.has(i)) continue;
    const t = allTriangles[i];
    for (const plane of facePlanes) {
      if (!pointInPolygonXZ(plane.hull2D, t.centroid[0], t.centroid[2])) continue;
      const h = signedDistanceToPlane(t.centroid, plane);
      if (h >= OBSTRUCTION_MIN_HEIGHT_M && h <= OBSTRUCTION_MAX_HEIGHT_M) {
        candidates.push({ centroid: t.centroid, triIdx: i, faceId: plane.faceId, height: h });
        break; // assign to the first face that owns it
      }
    }
  }

  if (candidates.length === 0) {
    return { obstructions: [], coverByFace: new Map() };
  }

  // Cluster spatially in XZ (one obstacle → one cluster).
  const points = candidates.map((c) => [c.centroid[0], c.centroid[2]]);
  const dbscan = new DBSCAN();
  const clusters = dbscan.run(points, OBSTRUCTION_DBSCAN_EPS_M, OBSTRUCTION_DBSCAN_MIN_POINTS);

  const obstructions: Obstruction[] = [];
  const coverByFace = new Map<number, number>();

  clusters.forEach((cluster, idx) => {
    if (cluster.length < OBSTRUCTION_DBSCAN_MIN_POINTS) return;
    const members = cluster.map((j) => candidates[j]);

    // Vote on faceId — majority wins.
    const faceVotes = new Map<number, number>();
    for (const m of members) faceVotes.set(m.faceId, (faceVotes.get(m.faceId) ?? 0) + 1);
    const faceId = [...faceVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Centroid + radius (max XZ distance from centroid to any member).
    let cx = 0;
    let cz = 0;
    let cy = 0;
    let minH = Infinity;
    let maxH = -Infinity;
    for (const m of members) {
      cx += m.centroid[0];
      cz += m.centroid[2];
      cy += m.centroid[1];
      if (m.height < minH) minH = m.height;
      if (m.height > maxH) maxH = m.height;
    }
    cx /= members.length;
    cz /= members.length;
    cy /= members.length;

    let radius = 0;
    for (const m of members) {
      const d = Math.hypot(m.centroid[0] - cx, m.centroid[2] - cz);
      if (d > radius) radius = d;
    }
    radius = Math.max(OBSTRUCTION_MIN_RADIUS_M, radius);

    const heightSpread = maxH - minH;
    const type = classifyObstruction(radius, heightSpread);

    obstructions.push({
      id: `${type}-${idx + 1}`,
      type,
      position: [cx, cy, cz],
      radius,
    });

    // Footprint area (with safety margin) charged to the parent face.
    const effectiveR = radius + OBSTRUCTION_SAFETY_MARGIN_M;
    const cover = Math.PI * effectiveR * effectiveR;
    coverByFace.set(faceId, (coverByFace.get(faceId) ?? 0) + cover);
  });

  return { obstructions, coverByFace };
}

function computeFootprint(triangles: Triangle[]): RoofGeometry['buildingFootprint'] {
  if (triangles.length === 0) {
    return { center: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const t of triangles) {
    const [x, y, z] = t.centroid;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

async function analyzeHouse(houseId: string): Promise<RoofGeometry> {
  // Prefer JSON dump from fetch-3d-tiles.ts (already in local ENU frame, meters).
  // Fall back to photogrammetry.glb if present, then to original Reonic GLBs.
  const photogrammetryJson = path.join(BAKED_DIR, `${houseId}-photogrammetry.json`);
  const photogrammetryGlb = path.join(BAKED_DIR, `${houseId}-photogrammetry.glb`);
  const fallback = path.join(FALLBACK_DIR, `${houseId}.glb`);

  let triangles: Triangle[];
  let sourceLabel: string;
  let origin: LatLng | null = null;
  if (await fileExists(photogrammetryJson)) {
    const result = await loadTrianglesFromJson(photogrammetryJson);
    triangles = result.triangles;
    origin = result.origin;
    sourceLabel = path.basename(photogrammetryJson);
  } else if (await fileExists(photogrammetryGlb)) {
    triangles = await loadTriangles(photogrammetryGlb);
    sourceLabel = path.basename(photogrammetryGlb);
  } else {
    console.warn(`[${houseId}] photogrammetry missing → falling back to ${fallback}`);
    triangles = await loadTriangles(fallback);
    sourceLabel = path.basename(fallback);
  }
  console.log(`[${houseId}] loaded ${triangles.length} triangles from ${sourceLabel}`);

  // If the dump is in ENU-local frame (origin = the address), restrict to THE
  // house at the centre. Strategy:
  //   1. Try to fetch the building polygon from OSM (Overpass API) — exact, handles mitoyennes.
  //   2. Fallback to a fixed-radius cylinder if Overpass is unreachable / building untracked.
  const isLocalFrame = sourceLabel.endsWith('.json');
  if (isLocalFrame) {
    const before = triangles.length;
    let polygon: { x: number; z: number }[] | null = null;
    if (origin) {
      console.log(`[${houseId}] querying OSM for building footprint at ${origin.lat}, ${origin.lng}…`);
      polygon = await fetchBuildingPolygon(origin);
    }
    if (polygon) {
      triangles = triangles.filter((t) => pointInPolygonXZ(polygon!, t.centroid[0], t.centroid[2]));
      console.log(`[${houseId}] kept ${triangles.length}/${before} triangles inside OSM building polygon (${polygon.length} vertices)`);
    } else {
      console.warn(`[${houseId}] OSM polygon unavailable → falling back to ${HOUSE_HORIZONTAL_RADIUS_M} m radius cylinder`);
      triangles = triangles.filter((t) => Math.hypot(t.centroid[0], t.centroid[2]) < HOUSE_HORIZONTAL_RADIUS_M);
      console.log(`[${houseId}] kept ${triangles.length}/${before} triangles within ${HOUSE_HORIZONTAL_RADIUS_M} m of the address`);
    }
  }

  // Track each triangle's index in the FULL list so we can later flag
  // which triangles are roof-cluster members vs. obstruction candidates.
  const roofTrisWithIndex: { tri: Triangle; originalIdx: number }[] = [];
  triangles.forEach((t, i) => {
    if (t.normal[1] > ROOF_NORMAL_Y_MIN) roofTrisWithIndex.push({ tri: t, originalIdx: i });
  });
  const roofTris = roofTrisWithIndex.map((r) => r.tri);
  const totalCandidateArea = roofTris.reduce((s, t) => s + t.area, 0);
  console.log(`[${houseId}] ${roofTris.length} candidate roof triangles after normal filter (total area ${totalCandidateArea.toFixed(1)} m²)`);

  const clusters = clusterRoofFaces(roofTris);
  // Keep clusters whose summed area > MIN_FACE_AREA_SQM.
  const significantClusters = clusters.filter((cluster) => {
    const totalArea = cluster.reduce((s, idx) => s + roofTris[idx].area, 0);
    return totalArea > MIN_FACE_AREA_SQM && cluster.length >= FACE_MIN_POINTS;
  });
  const significantArea = significantClusters.reduce(
    (s, c) => s + c.reduce((sa, idx) => sa + roofTris[idx].area, 0),
    0,
  );
  console.log(`[${houseId}] ${clusters.length} raw clusters → ${significantClusters.length} significant (total area ${significantArea.toFixed(1)} m²)`);
  // Diagnostic: print all cluster sizes so we can tell whether a 0-face result
  // is "no roof at all" vs. "many tiny clusters that all fell under threshold".
  if (significantClusters.length === 0) {
    const top = clusters
      .map((c) => ({ count: c.length, area: c.reduce((s, idx) => s + roofTris[idx].area, 0) }))
      .sort((a, b) => b.area - a.area)
      .slice(0, 8);
    console.log(`  diag: ${clusters.length} raw clusters, top areas:`, top.map((t) => `${t.count}t×${t.area.toFixed(1)}m²`).join(', '));
  }
  const sortedClusters = significantClusters
    .map((c) => c)
    .sort((a, b) => {
      const aArea = a.reduce((s, idx) => s + roofTris[idx].area, 0);
      const bArea = b.reduce((s, idx) => s + roofTris[idx].area, 0);
      return bArea - aArea;
    })
    .slice(0, 12);

  // Triangles assigned to a roof face (by ORIGINAL index in `triangles`).
  const assignedToFace = new Set<number>();
  for (const cluster of sortedClusters) {
    for (const localIdx of cluster) assignedToFace.add(roofTrisWithIndex[localIdx].originalIdx);
  }

  const faces: RoofFace[] = sortedClusters.map((cluster, idx) => {
    const tris = cluster.map((i) => roofTris[i]);
    const normal = meanNormal(tris);
    const azimuth = azimuthFromNormal(normal);
    const tilt = tiltFromNormal(normal);
    const area = tris.reduce((sum, t) => sum + t.area, 0);
    const allPoints = tris.flatMap((t) => t.vertices);
    const vertices = convexHullXZ(allPoints);
    return {
      id: idx,
      normal,
      area: Math.round(area * 10) / 10,
      usableArea: Math.round(area * 10) / 10, // refined below once obstructions are known
      azimuth: Math.round(azimuth),
      tilt: Math.round(tilt),
      vertices,
      yieldKwhPerSqm: computeYield(azimuth, tilt),
    };
  });

  // Detect chimneys / dormers / vents: triangles NOT in any roof cluster but
  // raised above some face's plane and inside its XZ outline.
  const facePlanes = faces.map(buildFacePlane);
  const { obstructions, coverByFace } = await detectObstructions(triangles, assignedToFace, facePlanes);
  console.log(`[${houseId}] detected ${obstructions.length} obstructions`);

  // Subtract obstacle footprints (with safety margin) from each face's usableArea.
  for (const face of faces) {
    const cover = coverByFace.get(face.id) ?? 0;
    face.usableArea = Math.max(0, Math.round((face.area - cover) * 10) / 10);
  }

  const buildingFootprint = computeFootprint(triangles);

  const modulePositions = faces.flatMap((face) => placePanelsOnFace(face, obstructions));

  return {
    houseId: houseId as RoofGeometry['houseId'],
    faces,
    obstructions,
    modulePositions,
    buildingFootprint,
  };
}

async function main() {
  await fs.mkdir(BAKED_DIR, { recursive: true });

  const onlyId = process.argv[2];
  const queue = onlyId ? HOUSES.filter((h) => h === onlyId) : HOUSES;
  if (onlyId && queue.length === 0) {
    console.error(`Unknown house "${onlyId}". Known: ${HOUSES.join(', ')}`);
    process.exit(1);
  }

  for (const house of queue) {
    console.log(`\n=== Analyzing ${house} ===`);
    try {
      const analysis = await analyzeHouse(house);
      const outPath = path.join(BAKED_DIR, `${house}-analysis.json`);
      await fs.writeFile(outPath, JSON.stringify(analysis, null, 2));
      console.log(`[${house}] wrote ${outPath} (${analysis.faces.length} faces, ${analysis.modulePositions?.length ?? 0} modules)`);
      // Human-readable summary
      const totalArea = analysis.faces.reduce((s, f) => s + f.area, 0);
      const totalUsable = analysis.faces.reduce((s, f) => s + f.usableArea, 0);
      console.log(`[${house}] roof summary:`);
      console.log(`         total area: ${totalArea.toFixed(1)} m²`);
      console.log(`         usable area: ${totalUsable.toFixed(1)} m² (after ${analysis.obstructions.length} obstacles)`);
      analysis.faces.forEach((f) => {
        console.log(
          `         face #${f.id}: ${f.area.toFixed(1)} m² (usable ${f.usableArea.toFixed(1)} m²) ` +
            `azimuth=${f.azimuth}° tilt=${f.tilt}° yield=${f.yieldKwhPerSqm} kWh/m²`,
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${house}] analysis failed:`, msg);
      if (msg.includes('KHR_draco_mesh_compression')) {
        console.error(
          `[${house}] hint: source GLB is Draco-compressed. Either run pnpm bake:fetch first ` +
            `(Google 3D Tiles output is uncompressed) OR register a Draco extension ` +
            `(@gltf-transform/extensions + draco3dgltf) on the NodeIO instance.`,
        );
      }
      console.error(`[${house}] keep the existing mock JSON in place — Dev A + Dev B remain unblocked.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
