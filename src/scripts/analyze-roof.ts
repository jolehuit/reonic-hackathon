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

import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import concaveman from 'concaveman';

import type { RoofFace, Obstruction, RoofGeometry } from '../lib/types';
import { placePanelsOnFace, type ShadeSampler } from './place-panels';
import { fetchMSBuildingFootprint } from '../lib/ms-building-footprints';

const HOUSES = [
  'berlin-dahlem', 'potsdam-golm', 'berlin-karow',
  'test1', 'test2', 'test3', 'test4',
  'bench-koeln1', 'bench-koeln2', 'bench-meerbusch', 'bench-leipzig',
  'bench-dresden1', 'bench-dresden2', 'bench-bochum', 'bench-hamburg2',
  'bench-berlin1', 'bench-berlin2', 'bench-uckermark',
  'b3-zehlendorf', 'b3-wannsee', 'b3-kladow', 'b3-mahlsdorf', 'b3-karow',
  'b3-lichterfelde', 'b3-hermsdorf', 'b3-mahlsdorf2', 'b3-hermsdorf2', 'b3-wannsee2',
] as const;

const BAKED_DIR = path.join(process.cwd(), 'public/baked');
const FALLBACK_DIR = path.join(process.cwd(), 'public/models');

// Env-overridable knobs (used by analyze-multi.ts to run several variants).
const numEnv = (name: string, def: number): number => {
  const v = process.env[name];
  return v !== undefined && !Number.isNaN(parseFloat(v)) ? parseFloat(v) : def;
};
const flagEnv = (name: string): boolean => process.env[name] === '1' || process.env[name] === 'true';

const VARIANT_BUFFER_M = numEnv('VARIANT_BUFFER_M', 0.8);              // OSM polygon buffer when adaptive triggers
const VARIANT_BUFFER_ALWAYS = flagEnv('VARIANT_BUFFER_ALWAYS');         // ignore the strict-floor adaptive trigger
const VARIANT_STRICT_FLOOR = numEnv('VARIANT_STRICT_FLOOR', 150);       // adaptive trigger threshold
const VARIANT_BUFFER_Y_BAND = numEnv('VARIANT_BUFFER_Y_BAND', 1.0);     // Y window for eaves rescue
const VARIANT_DEDUP_3D_M = numEnv('VARIANT_DEDUP_3D_M', 0.3);           // 3D dedup radius
const VARIANT_DEDUP_XZ_M = numEnv('VARIANT_DEDUP_XZ_M', 0.7);           // XZ dedup radius (with dY check)
const VARIANT_DEDUP_DY_M = numEnv('VARIANT_DEDUP_DY_M', 0.5);           // multi-level dedup vertical gap
const VARIANT_DROP_NORTH_TILT_MIN = numEnv('VARIANT_DROP_NORTH_TILT_MIN', 25);
const VARIANT_DROP_TINY_AREA = numEnv('VARIANT_DROP_TINY_AREA', 2);
const VARIANT_DROP_LOW_YIELD = numEnv('VARIANT_DROP_LOW_YIELD', 550);
const VARIANT_GRID_RES = numEnv('VARIANT_GRID_RES', 10);
const VARIANT_SLICE_TOP = numEnv('VARIANT_SLICE_TOP', 20);
// Multi-level filtering — for buildings with stacked roof topology
const VARIANT_TOP_LEVEL_FILTER = flagEnv('VARIANT_TOP_LEVEL_FILTER');     // keep only triangles within Y-band of local max
const VARIANT_TOP_LEVEL_CELL_M = numEnv('VARIANT_TOP_LEVEL_CELL_M', 2.0); // XZ cell size for local-max
const VARIANT_TOP_LEVEL_BAND_M = numEnv('VARIANT_TOP_LEVEL_BAND_M', 0.8); // Y tolerance below local max
const VARIANT_DOMINANT_LEVEL = flagEnv('VARIANT_DOMINANT_LEVEL');         // keep only largest Y-band cluster
const VARIANT_MEDIAN_BAND_M = numEnv('VARIANT_MEDIAN_BAND_M', 0);         // 0 = disabled, else keep Y in [median-X, median+X]
const VARIANT_PANEL_DENSITY_CAP = numEnv('VARIANT_PANEL_DENSITY_CAP', 1.0); // 1.0 = disabled
// Auto multi-level: when enabled (trigger > 0), if the P10..P90 Y range of
// in-polygon triangles exceeds AUTO_MULTI_LEVEL_TRIGGER, apply a median-Y
// band of AUTO_MULTI_LEVEL_BAND m to isolate the dominant roof. This is
// off by default — only the dedicated "multi-level-auto" variant turns it on
// so it can vote in the consensus alongside the residential-tuned variants.
const VARIANT_AUTO_MULTI_LEVEL_TRIGGER = numEnv('VARIANT_AUTO_MULTI_LEVEL_TRIGGER', 0);
const VARIANT_AUTO_MULTI_LEVEL_BAND = numEnv('VARIANT_AUTO_MULTI_LEVEL_BAND', 2.5);
// Minimum annual direct-beam flux per panel (kWh/m²/yr). 0 = disabled.
// Solar API rejects panels below ~750-800; we use a conservative 800 by default
// in the dedicated "flux-strict" variant.
const VARIANT_MIN_ANNUAL_FLUX = numEnv('VARIANT_MIN_ANNUAL_FLUX', 0);
// Use concave hull (alpha-shape) for face polygons instead of convex hull.
// Concavity 1.5-3.0 reasonable; higher = closer to convex.
const VARIANT_CONCAVE_HULL_CONCAVITY = numEnv('VARIANT_CONCAVE_HULL_CONCAVITY', 0); // 0 = disabled (use convex)
// Microsoft Building Footprints fallback: when 1, fetch MS polygon and use it
// instead of OSM if it's at least MS_VS_OSM_MIN_RATIO times larger AND contains
// the target point. Helps Reihenhäuser where OSM is drawn tight to the wall.
const VARIANT_USE_MS_FOOTPRINT = flagEnv('VARIANT_USE_MS_FOOTPRINT');
const VARIANT_MS_VS_OSM_MIN_RATIO = numEnv('VARIANT_MS_VS_OSM_MIN_RATIO', 1.1);
const VARIANT_MS_FORCE_IGNORE_CONTAINS = flagEnv('VARIANT_MS_FORCE_IGNORE_CONTAINS');
// Per-pavilion decomposition: spatial DBSCAN on triangle XZ centroids → keep
// only the largest cluster (dominant pavilion). Fixes multi-wing institutional
// buildings where the OSM polygon spans several disconnected roof sections.
// 0 = disabled.
const VARIANT_PAVILION_DBSCAN_EPS = numEnv('VARIANT_PAVILION_DBSCAN_EPS', 0);
const VARIANT_PAVILION_MIN_POINTS = Math.round(numEnv('VARIANT_PAVILION_MIN_POINTS', 20));
const OUTPUT_SUFFIX = process.env.OUTPUT_SUFFIX ?? '';

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

// Obstruction detection — env-overridable for variant tuning
const OBSTRUCTION_MIN_HEIGHT_M = numEnv('VARIANT_OBS_MIN_HEIGHT', 0.10);  // 0.15 → 0.10 catches vélux/skylights better
const OBSTRUCTION_MAX_HEIGHT_M = 2.5;
const OBSTRUCTION_DBSCAN_EPS_M = numEnv('VARIANT_OBS_DBSCAN_EPS', 0.4);
const OBSTRUCTION_DBSCAN_MIN_POINTS = Math.round(numEnv('VARIANT_OBS_DBSCAN_MIN_POINTS', 3)); // 4 → 3 keeps smaller obstacles
const OBSTRUCTION_SAFETY_MARGIN_M = numEnv('VARIANT_OBS_SAFETY_MARGIN', 0.5);  // 0.3 → 0.5 (Solar API typically uses 0.5-1m)
const OBSTRUCTION_MIN_RADIUS_M = 0.2;

interface Triangle {
  centroid: [number, number, number];
  normal: [number, number, number];
  area: number;
  vertices: [number, number, number][];
}

// ─── Multi-level filters (for buildings with stacked roof topology) ───────
//
// Address 3 (a multi-pavilion campus building) has a Y range of 30 m. Without
// these filters every Y level produces panels — Solar API only places on the
// dominant top-most accessible level. These filters reduce the candidate
// triangles BEFORE clustering so we don't even produce phantom faces.

/** Keep only triangles within `band` of the local-max Y in their XZ cell. */
function topLevelFilter(tris: Triangle[], cellSize: number, band: number): Triangle[] {
  const cells = new Map<string, number>();
  for (const t of tris) {
    const cx = Math.floor(t.centroid[0] / cellSize);
    const cz = Math.floor(t.centroid[2] / cellSize);
    const key = `${cx}|${cz}`;
    const cur = cells.get(key) ?? -Infinity;
    if (t.centroid[1] > cur) cells.set(key, t.centroid[1]);
  }
  return tris.filter((t) => {
    const cx = Math.floor(t.centroid[0] / cellSize);
    const cz = Math.floor(t.centroid[2] / cellSize);
    return t.centroid[1] >= (cells.get(`${cx}|${cz}`) ?? 0) - band;
  });
}

/** Keep only the Y-band cluster (1 m bands) with the largest summed area. */
function dominantLevelFilter(tris: Triangle[], bandM = 1.0): Triangle[] {
  if (tris.length === 0) return tris;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of tris) {
    if (t.centroid[1] < minY) minY = t.centroid[1];
    if (t.centroid[1] > maxY) maxY = t.centroid[1];
  }
  const nBands = Math.max(1, Math.ceil((maxY - minY) / bandM));
  const bands: { tris: Triangle[]; area: number }[] = Array.from({ length: nBands }, () => ({ tris: [], area: 0 }));
  for (const t of tris) {
    const idx = Math.min(nBands - 1, Math.max(0, Math.floor((t.centroid[1] - minY) / bandM)));
    bands[idx].tris.push(t);
    bands[idx].area += t.area;
  }
  // Find the band with max area, then expand to include adjacent bands within
  // 50 % of its area (handles a roof split across two bands by ridge height).
  let bestIdx = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i].area > bands[bestIdx].area) bestIdx = i;
  const bestArea = bands[bestIdx].area;
  const out: Triangle[] = [];
  for (let i = 0; i < bands.length; i++) {
    if (i === bestIdx || (Math.abs(i - bestIdx) <= 2 && bands[i].area > bestArea * 0.5)) {
      out.push(...bands[i].tris);
    }
  }
  return out;
}

/** Keep only triangles whose Y is within ±band of the median Y. */
function medianBandFilter(tris: Triangle[], band: number): Triangle[] {
  if (tris.length === 0) return tris;
  const ys = tris.map((t) => t.centroid[1]).sort((a, b) => a - b);
  const median = ys[Math.floor(ys.length / 2)];
  return tris.filter((t) => Math.abs(t.centroid[1] - median) <= band);
}

/**
 * Per-pavilion DBSCAN on XZ centroids. Returns triangles belonging to the
 * largest connected cluster (the dominant pavilion). For multi-pavillon
 * buildings this isolates the main wing and drops smaller wings/annexes
 * that physically belong to a different roof section.
 */
async function pavilionFilter(
  tris: Triangle[],
  origin: { x: number; z: number } | null,
  epsM: number,
  minPoints: number,
): Promise<Triangle[]> {
  if (tris.length < minPoints) return tris;
  const { DBSCAN } = await import('density-clustering');
  const points = tris.map((t) => [t.centroid[0], t.centroid[2]]);
  const dbscan = new DBSCAN();
  const clusters = dbscan.run(points, epsM, minPoints);
  if (clusters.length <= 1) return tris;
  // Sort clusters by size (largest first). If origin is provided, prefer the
  // cluster CONTAINING the origin (the user's address) over the absolute
  // largest — handles cases where a neighbour wing happens to be slightly
  // bigger than the address's pavilion.
  if (origin) {
    for (const c of clusters) {
      const tx = c.map((i) => tris[i]);
      const minX = Math.min(...tx.map((t) => t.centroid[0]));
      const maxX = Math.max(...tx.map((t) => t.centroid[0]));
      const minZ = Math.min(...tx.map((t) => t.centroid[2]));
      const maxZ = Math.max(...tx.map((t) => t.centroid[2]));
      if (origin.x >= minX && origin.x <= maxX && origin.z >= minZ && origin.z <= maxZ) {
        return tx;
      }
    }
  }
  // Fallback: take the largest cluster.
  let bestArea = 0;
  let bestCluster = clusters[0];
  for (const c of clusters) {
    const area = c.reduce((s, i) => s + tris[i].area, 0);
    if (area > bestArea) { bestArea = area; bestCluster = c; }
  }
  return bestCluster.map((i) => tris[i]);
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
  const GRID_RES = VARIANT_GRID_RES;
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
  // Andrew's monotone chain in the XZ plane — preserves each vertex's original
  // Y so a tilted roof face keeps its 3D shape (place-panels.ts needs the real
  // Y to build a non-degenerate face frame).
  if (points.length < 3) return points;
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
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// Concave hull (alpha-shape via concaveman). Concavity ~1.5-3.0 reasonable —
// lower = tighter to the point set (catches L/U-shaped concavities), higher =
// closer to convex. Y is restored from the closest input point.
function concaveHullXZ(
  points: [number, number, number][],
  concavity: number,
): [number, number, number][] {
  if (points.length < 4) return convexHullXZ(points);
  const xz = points.map((p) => [p[0], p[2]]);
  const hullXZ = concaveman(xz, concavity);
  // Restore Y per hull vertex: nearest neighbour in original points.
  return hullXZ.map(([x, z]) => {
    let bestY = points[0][1];
    let bestD = Infinity;
    for (const p of points) {
      const d = Math.hypot(p[0] - x, p[2] - z);
      if (d < bestD) { bestD = d; bestY = p[1]; }
    }
    return [x, bestY, z] as [number, number, number];
  });
}

/** Resolve hull selection — picks concave or convex based on env. */
function hullXZ(points: [number, number, number][]): [number, number, number][] {
  if (VARIANT_CONCAVE_HULL_CONCAVITY > 0) {
    return concaveHullXZ(points, VARIANT_CONCAVE_HULL_CONCAVITY);
  }
  return convexHullXZ(points);
}

function computeYield(azimuth: number, tilt: number): number {
  const azDelta = Math.min(Math.abs(azimuth - OPTIMAL_AZIMUTH_DEG), 360 - Math.abs(azimuth - OPTIMAL_AZIMUTH_DEG));
  const tiltDelta = Math.abs(tilt - OPTIMAL_TILT_DEG);
  const azFactor = Math.cos((azDelta * Math.PI) / 180);
  const tiltFactor = Math.cos((tiltDelta * Math.PI) / 180);
  const factor = Math.max(0.45, 0.6 + 0.2 * azFactor + 0.2 * tiltFactor);
  return Math.round(BASELINE_YIELD_KWH_PER_SQM * factor);
}

// ─── Face post-processing: merge adjacent + drop unproductive ──────────────

const MERGE_AZIMUTH_DEG = 20;
const MERGE_TILT_DEG = 8;
const MERGE_HULL_DIST_M = 1.5;
const DROP_NORTH_AZIMUTH_BAND = 30; // azimuth in [330, 30] = "true north" cone (narrower)
const DROP_NORTH_TILT_MIN = VARIANT_DROP_NORTH_TILT_MIN;
const DROP_WALLISH_TILT_MAX = 70;   // only drop near-vertical (was 60)
const DROP_TINY_AREA_MIN = VARIANT_DROP_TINY_AREA;

function azimuthDelta(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function hullsClose(a: RoofFace, b: RoofFace, threshold: number): boolean {
  // Cheap: any vertex of A within `threshold` of any vertex of B.
  for (const va of a.vertices) {
    for (const vb of b.vertices) {
      const dx = va[0] - vb[0];
      const dz = va[2] - vb[2];
      if (Math.hypot(dx, dz) < threshold) return true;
    }
  }
  return false;
}

function canMerge(a: RoofFace, b: RoofFace): boolean {
  if (azimuthDelta(a.azimuth, b.azimuth) > MERGE_AZIMUTH_DEG) return false;
  if (Math.abs(a.tilt - b.tilt) > MERGE_TILT_DEG) return false;
  return hullsClose(a, b, MERGE_HULL_DIST_M);
}

function mergeTwoFaces(a: RoofFace, b: RoofFace, newId: number): RoofFace {
  const totalArea = a.area + b.area;
  // Area-weighted normal.
  const nx = (a.normal[0] * a.area + b.normal[0] * b.area) / totalArea;
  const ny = (a.normal[1] * a.area + b.normal[1] * b.area) / totalArea;
  const nz = (a.normal[2] * a.area + b.normal[2] * b.area) / totalArea;
  const len = Math.hypot(nx, ny, nz) || 1;
  const normal: [number, number, number] = [nx / len, ny / len, nz / len];
  const azimuth = Math.round(azimuthFromNormal(normal));
  const tilt = Math.round(tiltFromNormal(normal));
  const vertices = hullXZ([...a.vertices, ...b.vertices] as [number, number, number][]);
  return {
    id: newId,
    normal,
    area: Math.round(totalArea * 10) / 10,
    usableArea: Math.round(totalArea * 10) / 10,
    azimuth,
    tilt,
    vertices,
    yieldKwhPerSqm: computeYield(azimuth, tilt),
  };
}

function mergeFaces(faces: RoofFace[]): RoofFace[] {
  const merged = [...faces];
  let changed = true;
  let nextId = faces.length;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (canMerge(merged[i], merged[j])) {
          merged[i] = mergeTwoFaces(merged[i], merged[j], nextId++);
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  // Re-id sequentially so face.id matches array index downstream.
  return merged.map((f, idx) => ({ ...f, id: idx }));
}

// Yield threshold below which a face isn't worth panels.
const DROP_LOW_YIELD = VARIANT_DROP_LOW_YIELD;

function dropBadFaces(faces: RoofFace[]): { kept: RoofFace[]; dropped: { face: RoofFace; reason: string }[] } {
  const kept: RoofFace[] = [];
  const dropped: { face: RoofFace; reason: string }[] = [];
  for (const f of faces) {
    if (f.area < DROP_TINY_AREA_MIN) {
      dropped.push({ face: f, reason: `area<${DROP_TINY_AREA_MIN}` });
      continue;
    }
    if (f.tilt > DROP_WALLISH_TILT_MAX) {
      dropped.push({ face: f, reason: `tilt>${DROP_WALLISH_TILT_MAX}` });
      continue;
    }
    const isNorth = f.azimuth >= 360 - DROP_NORTH_AZIMUTH_BAND || f.azimuth <= DROP_NORTH_AZIMUTH_BAND;
    if (isNorth && f.tilt > DROP_NORTH_TILT_MIN) {
      dropped.push({ face: f, reason: `north-steep` });
      continue;
    }
    if (f.yieldKwhPerSqm < DROP_LOW_YIELD) {
      dropped.push({ face: f, reason: `yield<${DROP_LOW_YIELD}` });
      continue;
    }
    kept.push(f);
  }
  return { kept, dropped };
}

// ─── Self-shading via SunCalc + THREE.Raycaster ────────────────────────────
//
// The photogrammetry mesh contains the building itself + neighbours that fell
// inside the 240×240m crop. For each candidate panel position, we trace rays
// to a sample of sun positions across the year. If too many rays hit the mesh
// before reaching the sun, the panel is rejected (in shadow most of the time).

const SHADE_SAMPLE_DATES = (() => {
  const dates: Date[] = [];
  // 21st of each month at three solar hours: 09:00, 12:00, 15:00 UTC.
  // For longitudes around Germany (~12°E), local solar noon ≈ 11:15 UTC, so
  // these three samples bracket the productive part of the day reasonably well.
  for (let m = 0; m < 12; m++) {
    for (const h of [9, 12, 15]) {
      dates.push(new Date(Date.UTC(2025, m, 21, h, 0, 0)));
    }
  }
  return dates;
})();

// Denser sample for annual-flux integration. 12 months × 7 daylight hours
// (6, 8, 10, 12, 14, 16, 18 UTC), each sample covers a 2-hour bin × 30 days.
const FLUX_SAMPLE_HOURS = [6, 8, 10, 12, 14, 16, 18];
const FLUX_SAMPLE_DATES = (() => {
  const dates: Date[] = [];
  for (let m = 0; m < 12; m++) {
    for (const h of FLUX_SAMPLE_HOURS) {
      dates.push(new Date(Date.UTC(2025, m, 21, h, 0, 0)));
    }
  }
  return dates;
})();
const FLUX_HOURS_PER_SAMPLE = 2 * 30; // 2-hour bin × 30 days
// Effective surface irradiance (W/m²). Solar constant at sea level ~1000 W/m²;
// after average annual atmospheric/cloud loss for central Europe ≈ 500 W/m².
// Calibrated so a S/30°-tilt panel in Brandenburg yields ~1000 kWh/m²/yr,
// matching Solar API's sunshineQuantiles for that orientation.
const FLUX_CLEAR_SKY_W = 500;

interface SunDir {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert SunCalc altitude/azimuth (rad, 0=south, +west) to a unit vector in
 * our local Y-up frame (X=East, Y=Up, Z=South). Returns null if the sun is
 * below the horizon.
 */
function sunDirToLocal(altitude: number, azimuth: number): SunDir | null {
  if (altitude < 0.05) return null; // below horizon (or grazing)
  const cosAlt = Math.cos(altitude);
  return {
    x: -cosAlt * Math.sin(azimuth), // east when az=-π/2, west when az=+π/2
    y: Math.sin(altitude),          // up
    z: cosAlt * Math.cos(azimuth),  // south when az=0, north when az=π
  };
}

async function buildShadeSampler(
  photogrammetryPath: string,
  originLat: number,
  originLng: number,
): Promise<ShadeSampler | null> {
  let raw: string;
  try {
    raw = await fs.readFile(photogrammetryPath, 'utf-8');
  } catch {
    return null;
  }
  const data = JSON.parse(raw) as { positions: number[]; indices: number[] };
  if (!data.positions || !data.indices) return null;

  // BVH-accelerated raycasting: ~10-100× faster than brute-force iteration
  // over 100k+ triangles. We build the bounds tree once per analyse.
  const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = await import('three-mesh-bvh');
  // Augment THREE prototypes (idempotent — safe to call again).
  (THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
  (THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geom.setIndex(data.indices);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  (geom as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
  const mesh = new THREE.Mesh(geom);
  mesh.updateMatrixWorld(true);

  // Pre-compute sun directions in local frame, drop below-horizon ones.
  const sunDirs: SunDir[] = [];
  for (const date of SHADE_SAMPLE_DATES) {
    const { altitude, azimuth } = SunCalc.getPosition(date, originLat, originLng);
    const dir = sunDirToLocal(altitude, azimuth);
    if (dir) sunDirs.push(dir);
  }
  if (sunDirs.length === 0) return null;

  // Denser sun samples (with hour-weights) for annual-flux integration.
  const fluxSuns: SunDir[] = [];
  for (const date of FLUX_SAMPLE_DATES) {
    const { altitude, azimuth } = SunCalc.getPosition(date, originLat, originLng);
    const dir = sunDirToLocal(altitude, azimuth);
    if (dir) fluxSuns.push(dir);
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = 1000;
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();

  return {
    shadedFraction(x: number, y: number, z: number): number {
      // Lift the origin slightly above the panel plane to avoid self-hits on
      // the supporting roof triangle.
      origin.set(x, y + 0.05, z);
      let hits = 0;
      for (const dir of sunDirs) {
        direction.set(dir.x, dir.y, dir.z);
        raycaster.set(origin, direction);
        const intersects = raycaster.intersectObject(mesh, false);
        // Ignore intersections within 0.1m (numerical noise from neighbouring
        // triangles of the supporting face).
        const realHit = intersects.some((it) => it.distance > 0.1);
        if (realHit) hits++;
      }
      return hits / sunDirs.length;
    },
    annualFlux(x: number, y: number, z: number, normal: [number, number, number]): number {
      // Integrate cos(θ) × clear-sky irradiance × hours-per-sample for each
      // unblocked sun position. Returns kWh/m²/yr received at the panel.
      origin.set(x, y + 0.05, z);
      let kwh = 0;
      for (const sun of fluxSuns) {
        // cos(angle between panel normal and sun direction)
        const cosAng = normal[0] * sun.x + normal[1] * sun.y + normal[2] * sun.z;
        if (cosAng <= 0) continue; // sun behind panel
        direction.set(sun.x, sun.y, sun.z);
        raycaster.set(origin, direction);
        const intersects = raycaster.intersectObject(mesh, false);
        if (intersects.some((it) => it.distance > 0.1)) continue; // shaded
        kwh += FLUX_CLEAR_SKY_W * cosAng * FLUX_HOURS_PER_SAMPLE / 1000;
      }
      return kwh;
    },
  };
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

/** Min distance from point to polygon edges (segments). */
function distToPolygonXZ(polygon: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const dx = pi.x - pj.x;
    const dz = pi.z - pj.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 < 1e-9 ? 0 : ((x - pj.x) * dx + (z - pj.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = pj.x + t * dx;
    const projZ = pj.z + t * dz;
    const d = Math.hypot(x - projX, z - projZ);
    if (d < best) best = d;
  }
  return best;
}

/** Inside-or-within-buffer test (catches eaves overhanging the OSM outline). */
function pointInBufferedPolygonXZ(
  polygon: { x: number; z: number }[],
  x: number,
  z: number,
  buffer: number,
): boolean {
  if (pointInPolygonXZ(polygon, x, z)) return true;
  return distToPolygonXZ(polygon, x, z) <= buffer;
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
      // Cache the polygon by house — avoids hammering Overpass when multiple
      // variants run in parallel (analyze-multi.ts). The cache is invalidated
      // by deleting the file or re-running fetch.
      const cachePath = path.join(BAKED_DIR, `${houseId}-osm-polygon.json`);
      if (await fileExists(cachePath)) {
        try {
          polygon = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as { x: number; z: number }[];
          console.log(`[${houseId}] using cached OSM polygon (${polygon.length} vertices)`);
        } catch {
          polygon = null;
        }
      }
      if (!polygon) {
        console.log(`[${houseId}] querying OSM for building footprint at ${origin.lat}, ${origin.lng}…`);
        polygon = await fetchBuildingPolygon(origin);
        if (polygon) {
          await fs.writeFile(cachePath, JSON.stringify(polygon));
        }
      }

      // Microsoft Building Footprints fallback — when OSM polygon is drawn
      // tight to the wall and misses the eaves overhang (typical Reihenhäuser
      // case), MS Footprints often catches the wider roof outline.
      if (VARIANT_USE_MS_FOOTPRINT && polygon) {
        const osmAreaXZ = (() => {
          let s = 0;
          for (let i = 0, j = polygon!.length - 1; i < polygon!.length; j = i++) {
            s += polygon![j].x * polygon![i].z - polygon![i].x * polygon![j].z;
          }
          return Math.abs(s / 2);
        })();
        try {
          const ms = await fetchMSBuildingFootprint(origin.lat, origin.lng);
          if (ms && (ms.containsTarget || VARIANT_MS_FORCE_IGNORE_CONTAINS)) {
            const ratio = ms.approxAreaM2 / Math.max(osmAreaXZ, 1);
            if (ratio >= VARIANT_MS_VS_OSM_MIN_RATIO) {
              const msPoly = ms.polygon.map((p) => latLngToLocalXZ(p, origin));
              console.log(
                `[${houseId}] MS Footprints: ${ms.approxAreaM2.toFixed(0)} m² > OSM ${osmAreaXZ.toFixed(0)} m² × ${VARIANT_MS_VS_OSM_MIN_RATIO} → using MS polygon (${msPoly.length} vertices)`,
              );
              polygon = msPoly;
            } else {
              console.log(`[${houseId}] MS Footprints: ${ms.approxAreaM2.toFixed(0)} m² ≈ OSM ${osmAreaXZ.toFixed(0)} m² (ratio ${ratio.toFixed(2)} < ${VARIANT_MS_VS_OSM_MIN_RATIO}) — keeping OSM`);
            }
          }
        } catch (err) {
          console.warn(`[${houseId}] MS Footprints fetch failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    if (polygon) {
      // Strict pass first.
      const strict = triangles.filter((t) => pointInPolygonXZ(polygon!, t.centroid[0], t.centroid[2]));

      // Eaves rescue: triangles within VARIANT_BUFFER_M of the polygon edge
      // and within VARIANT_BUFFER_Y_BAND of the strict-pass median Y. By
      // default we only enable it when strict is "starved" (< floor), but
      // the variant runner can force it on with VARIANT_BUFFER_ALWAYS=1.
      let eaves: Triangle[] = [];
      const useBuffer = VARIANT_BUFFER_ALWAYS || (strict.length < VARIANT_STRICT_FLOOR && strict.length > 0);
      if (useBuffer && strict.length > 0) {
        const sortedY = strict.map((t) => t.centroid[1]).sort((a, b) => a - b);
        const medianY = sortedY[Math.floor(sortedY.length / 2)];
        eaves = triangles.filter((t) => {
          if (pointInPolygonXZ(polygon!, t.centroid[0], t.centroid[2])) return false;
          if (Math.abs(t.centroid[1] - medianY) > VARIANT_BUFFER_Y_BAND) return false;
          return distToPolygonXZ(polygon!, t.centroid[0], t.centroid[2]) <= VARIANT_BUFFER_M;
        });
        console.log(
          `[${houseId}] strict ${strict.length} (${VARIANT_BUFFER_ALWAYS ? 'forced' : '< ' + VARIANT_STRICT_FLOOR}) → adding ${eaves.length} eaves within ${VARIANT_BUFFER_M} m & Y±${VARIANT_BUFFER_Y_BAND} of ${medianY.toFixed(1)}`,
        );
      } else {
        console.log(`[${houseId}] kept ${strict.length}/${before} triangles strictly inside OSM polygon (${polygon.length} vertices)`);
      }
      triangles = [...strict, ...eaves];
    } else {
      console.warn(`[${houseId}] OSM polygon unavailable → falling back to ${HOUSE_HORIZONTAL_RADIUS_M} m radius cylinder`);
      triangles = triangles.filter((t) => Math.hypot(t.centroid[0], t.centroid[2]) < HOUSE_HORIZONTAL_RADIUS_M);
      console.log(`[${houseId}] kept ${triangles.length}/${before} triangles within ${HOUSE_HORIZONTAL_RADIUS_M} m of the address`);
    }
  }

  // Multi-level filters — applied AFTER the building isolation step. For
  // single-level houses these are no-ops; for stacked / pavilion buildings
  // (Address 3) they trim phantom roof levels that would otherwise produce
  // duplicate panel slots.
  if (VARIANT_TOP_LEVEL_FILTER) {
    const before = triangles.length;
    triangles = topLevelFilter(triangles, VARIANT_TOP_LEVEL_CELL_M, VARIANT_TOP_LEVEL_BAND_M);
    console.log(`[${houseId}] top-level filter (cell ${VARIANT_TOP_LEVEL_CELL_M} m, band ${VARIANT_TOP_LEVEL_BAND_M} m) kept ${triangles.length}/${before}`);
  }
  if (VARIANT_DOMINANT_LEVEL) {
    const before = triangles.length;
    triangles = dominantLevelFilter(triangles, 1.0);
    console.log(`[${houseId}] dominant-level filter kept ${triangles.length}/${before}`);
  }
  if (VARIANT_MEDIAN_BAND_M > 0) {
    const before = triangles.length;
    triangles = medianBandFilter(triangles, VARIANT_MEDIAN_BAND_M);
    console.log(`[${houseId}] median-band filter (±${VARIANT_MEDIAN_BAND_M} m) kept ${triangles.length}/${before}`);
  }
  // Per-pavilion spatial DBSCAN — keeps only the largest XZ-connected cluster.
  // For multi-wing buildings (Address 3 university campus) the OSM polygon
  // spans several roof sections; this isolates the one containing the address.
  if (VARIANT_PAVILION_DBSCAN_EPS > 0 && triangles.length > 0) {
    const before = triangles.length;
    triangles = await pavilionFilter(
      triangles,
      origin ? { x: 0, z: 0 } : null, // address is the origin in local frame
      VARIANT_PAVILION_DBSCAN_EPS,
      VARIANT_PAVILION_MIN_POINTS,
    );
    console.log(`[${houseId}] pavilion filter (eps ${VARIANT_PAVILION_DBSCAN_EPS} m, min ${VARIANT_PAVILION_MIN_POINTS} pts) kept ${triangles.length}/${before}`);
  }

  // Auto multi-level detection: a residential roof's middle-80% Y range
  // (P90 − P10) is roughly the eaves-to-ridge span (~3-6 m). A pavilion or
  // multi-pan building has a much larger one (12 m+) because separate roof
  // levels show up as distinct Y populations. When that's the case we apply
  // the median-band filter to isolate the dominant pan.
  let autoMultiLevelFired = false;
  let autoMultiLevelP80Range: number | undefined;
  if (VARIANT_AUTO_MULTI_LEVEL_TRIGGER > 0 && triangles.length > 10) {
    const ys = triangles.map((t) => t.centroid[1]).sort((a, b) => a - b);
    const p10 = ys[Math.floor(ys.length * 0.10)];
    const p90 = ys[Math.floor(ys.length * 0.90)];
    const p80Range = p90 - p10;
    autoMultiLevelP80Range = p80Range;
    if (p80Range > VARIANT_AUTO_MULTI_LEVEL_TRIGGER) {
      const before = triangles.length;
      triangles = medianBandFilter(triangles, VARIANT_AUTO_MULTI_LEVEL_BAND);
      autoMultiLevelFired = true;
      console.log(
        `[${houseId}] auto-multi-level: P10..P90 Y range ${p80Range.toFixed(1)} m > ${VARIANT_AUTO_MULTI_LEVEL_TRIGGER} m → median-band ±${VARIANT_AUTO_MULTI_LEVEL_BAND} m kept ${triangles.length}/${before}`,
      );
    } else {
      console.log(`[${houseId}] auto-multi-level: P10..P90 Y range ${p80Range.toFixed(1)} m ≤ ${VARIANT_AUTO_MULTI_LEVEL_TRIGGER} m → no filter`);
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
    .slice(0, VARIANT_SLICE_TOP);

  // Triangles assigned to a roof face (by ORIGINAL index in `triangles`).
  const assignedToFace = new Set<number>();
  for (const cluster of sortedClusters) {
    for (const localIdx of cluster) assignedToFace.add(roofTrisWithIndex[localIdx].originalIdx);
  }

  const rawFaces: RoofFace[] = sortedClusters.map((cluster, idx) => {
    const tris = cluster.map((i) => roofTris[i]);
    const normal = meanNormal(tris);
    const azimuth = azimuthFromNormal(normal);
    const tilt = tiltFromNormal(normal);
    const area = tris.reduce((sum, t) => sum + t.area, 0);
    const allPoints = tris.flatMap((t) => t.vertices);
    const vertices = hullXZ(allPoints);
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

  // Post-process: merge adjacent same-orientation pans, then drop unproductive
  // ones (north-facing pitched, wall-like, or too small for any panel).
  const mergedFaces = mergeFaces(rawFaces);
  const { kept: faces, dropped } = dropBadFaces(mergedFaces);
  console.log(`[${houseId}] faces: ${rawFaces.length} raw → ${mergedFaces.length} merged → ${faces.length} kept (drop ${dropped.length})`);
  if (dropped.length > 0) {
    const dropLog = dropped
      .map((d) => `${d.face.area.toFixed(1)}m² az=${d.face.azimuth} tilt=${d.face.tilt} (${d.reason})`)
      .join(', ');
    console.log(`[${houseId}]   dropped: ${dropLog}`);
  }

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

  // Self-shading sampler — uses the full photogrammetry mesh + SunCalc to
  // reject panels that are shadowed by chimneys, dormers, or neighbour walls.
  let shadeSampler: ShadeSampler | null = null;
  if (origin && (await fileExists(photogrammetryJson))) {
    console.log(`[${houseId}] building shade sampler from photogrammetry mesh…`);
    shadeSampler = await buildShadeSampler(photogrammetryJson, origin.lat, origin.lng);
  }

  let rawPanels = faces.flatMap((face) =>
    placePanelsOnFace(face, obstructions, undefined, shadeSampler ?? undefined),
  );

  // Annual-flux filter — drops panels whose integrated kWh/m²/yr is below
  // VARIANT_MIN_ANNUAL_FLUX. Each panel needs its face's normal to compute
  // cos(angle to sun); we look it up from the faces array.
  if (VARIANT_MIN_ANNUAL_FLUX > 0 && shadeSampler?.annualFlux) {
    const before = rawPanels.length;
    const faceNormals = new Map<number, [number, number, number]>();
    for (const f of faces) faceNormals.set(f.id, f.normal);
    let droppedSum = 0;
    rawPanels = rawPanels.filter((p) => {
      const n = faceNormals.get(p.faceId);
      if (!n) return true; // shouldn't happen, keep to be safe
      const flux = shadeSampler!.annualFlux!(p.x, p.y, p.z, n);
      if (flux < VARIANT_MIN_ANNUAL_FLUX) {
        droppedSum++;
        return false;
      }
      return true;
    });
    console.log(`[${houseId}] flux filter (≥${VARIANT_MIN_ANNUAL_FLUX} kWh/m²/yr): ${before} → ${rawPanels.length} panels (dropped ${droppedSum})`);
  }

  // Two-mode deduplication:
  //  (a) Same-level dup: panels < 0.5 m in 3D (overlapping cluster faces on
  //      the same physical pitch). Same-face neighbours are ≥ 1.07 m apart so
  //      this is safe.
  //  (b) Cross-level dup: panels < 0.7 m in XZ but with > 0.5 m of Y diff —
  //      that's two stacked roof levels (e.g. dormer above main pan). Keep the
  //      higher one, the lower one is physically obscured.
  const DEDUP_3D_M = VARIANT_DEDUP_3D_M;
  const DEDUP_XZ_M = VARIANT_DEDUP_XZ_M;
  const DEDUP_LEVEL_DY_M = VARIANT_DEDUP_DY_M;
  // Sort by Y descending so stacked-level dedup keeps the top panel first.
  const sortedPanels = [...rawPanels].sort((a, b) => b.y - a.y);
  const modulePositions: typeof rawPanels = [];
  for (const p of sortedPanels) {
    let dup = false;
    for (const k of modulePositions) {
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const dz = p.z - k.z;
      const xz = Math.hypot(dx, dz);
      const d3 = Math.sqrt(xz * xz + dy * dy);
      if (d3 < DEDUP_3D_M) {
        dup = true;
        break;
      }
      if (xz < DEDUP_XZ_M && Math.abs(dy) > DEDUP_LEVEL_DY_M) {
        dup = true;
        break;
      }
    }
    if (!dup) modulePositions.push(p);
  }
  console.log(`[${houseId}] panels: ${rawPanels.length} raw → ${modulePositions.length} after dedup`);

  // Top-level summary fields — consumed by /api/design without parsing arrays.
  const PANEL_AREA_M2 = 1.045 * 1.879;
  const roofTotalAreaSqm = Math.round(faces.reduce((s, f) => s + f.area, 0) * 10) / 10;
  const roofUsableAreaSqm = Math.round(faces.reduce((s, f) => s + f.usableArea, 0) * 10) / 10;
  const modulesMax = modulePositions.length;
  const modulesMaxAreaSqm = Math.round(modulesMax * PANEL_AREA_M2 * 10) / 10;

  return {
    houseId: houseId as RoofGeometry['houseId'],
    faces,
    obstructions,
    modulePositions,
    buildingFootprint,
    modulesMax,
    modulesMaxAreaSqm,
    roofTotalAreaSqm,
    roofUsableAreaSqm,
    _autoMultiLevel: {
      fired: autoMultiLevelFired,
      p80Range: autoMultiLevelP80Range,
      trigger: VARIANT_AUTO_MULTI_LEVEL_TRIGGER,
    },
  } as RoofGeometry;
}

async function main() {
  await fs.mkdir(BAKED_DIR, { recursive: true });

  const onlyId = process.argv[2];
  // Accept ad-hoc IDs prefixed with "live-" (used by /api/design when GPS
  // coords miss the cache and we fetch+analyze on demand).
  const isLiveId = onlyId?.startsWith('live-');
  let queue: readonly string[];
  if (isLiveId) {
    queue = [onlyId!];
  } else {
    queue = onlyId ? HOUSES.filter((h) => h === onlyId) : HOUSES;
    if (onlyId && queue.length === 0) {
      console.error(`Unknown house "${onlyId}". Known: ${HOUSES.join(', ')}`);
      process.exit(1);
    }
  }

  for (const house of queue) {
    console.log(`\n=== Analyzing ${house} ===`);
    try {
      const analysis = await analyzeHouse(house);
      const outPath = path.join(BAKED_DIR, `${house}-analysis${OUTPUT_SUFFIX}.json`);
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
