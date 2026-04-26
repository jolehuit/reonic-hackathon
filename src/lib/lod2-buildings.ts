// LOD2-Gebäudemodelle — official cadastral 3D building polygons from German
// Vermessungsämter. Used as a SAFETY-NET fallback when the OSM/MS variant
// pipeline produces an aberrant result (per analyze-multi.ts isAberrant()).
//
// Two sources implemented:
//   - NRW: live REST API ogc-api.nrw.de/3dg/v1 (CityJSON 1.1, bbox query)
//   - Sachsen: offline tile cache in data/lod2-sachsen/ (no public API,
//              tiles must be downloaded manually from geodaten.sachsen.de)
//
// Output: official RoofSurface polygons with normals + tilts + areas, ready
// to feed placePanelsOnFace() (place-panels.ts) — no clustering needed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import proj4 from 'proj4';

// Register projections — Brandenburg & Sachsen use UTM33N (EPSG:25833)
proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const CACHE_DIR = path.join(process.cwd(), 'public/baked');
const SACHSEN_TILES_DIR = path.join(process.cwd(), 'data/lod2-sachsen');
const BRANDENBURG_TILES_DIR = path.join(process.cwd(), 'data/lod2-brandenburg');
const BRANDENBURG_BASE_URL = 'https://data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml';
const BERLIN_TILES_DIR = path.join(process.cwd(), 'data/lod2-berlin');
const BERLIN_BASE_URL = 'https://gdi.berlin.de/data/a_lod2/atom';

// Bounding boxes per Land (rough, used for routing only — not for filtering).
// Order matters: more specific (Berlin) MUST come before larger neighbours
// (Brandenburg) so detectLand() returns the right Land for the city-state.
// Format: [minLat, minLng, maxLat, maxLng]
const LAND_BBOXES: Record<string, [number, number, number, number]> = {
  NRW: [50.32, 5.86, 52.53, 9.46],         // Nordrhein-Westfalen
  Berlin: [52.34, 13.09, 52.68, 13.76],     // City-state, must be checked BEFORE Brandenburg
  Brandenburg: [51.36, 11.27, 53.56, 14.77],
  Sachsen: [50.17, 11.87, 51.69, 15.04],
};

export interface LOD2RoofSurface {
  /** [x, y, z] vertices in local ENU meters around origin */
  polygon: [number, number, number][];
  /** Outward unit normal in ENU local frame (Y-up) */
  normal: [number, number, number];
  /** Tilt from horizontal in degrees (0 = flat, 90 = vertical wall) */
  tilt: number;
  /** Azimuth in degrees (0=N, 90=E, 180=S, 270=W) */
  azimuth: number;
  /** Surface area in square meters */
  area: number;
}

export interface LOD2Building {
  source: 'NRW' | 'Berlin' | 'Brandenburg' | 'Sachsen';
  buildingId: string;
  /** Footprint vertices in ENU local meters (XZ plane, Y=0) */
  footprint: [number, number][];
  roofSurfaces: LOD2RoofSurface[];
  /** Total roof area (sum of roofSurfaces) */
  totalRoofArea: number;
}

interface CityJSONVertex {
  raw: [number, number, number];
}

interface CityJSONDoc {
  type: 'CityJSON';
  version: string;
  metadata?: { referenceSystem?: string };
  transform: { scale: [number, number, number]; translate: [number, number, number] };
  CityObjects: Record<string, CityJSONObject>;
  vertices: [number, number, number][];
}

interface CityJSONObject {
  type: 'Building' | 'BuildingPart' | string;
  parents?: string[];
  children?: string[];
  attributes?: Record<string, unknown>;
  geometry?: CityJSONGeometry[];
}

interface CityJSONGeometry {
  type: 'Solid' | 'MultiSurface' | string;
  lod?: string;
  boundaries: number[][][][];  // [solid][shell][face][ring of vertex indices]
  semantics?: {
    surfaces: { type: string }[];
    values: number[][];  // [shell][face → surface index]
  };
}

/** Detect which Land (state) a coordinate is in. */
function detectLand(lat: number, lng: number): 'NRW' | 'Berlin' | 'Brandenburg' | 'Sachsen' | null {
  for (const [land, [minLat, minLng, maxLat, maxLng]] of Object.entries(LAND_BBOXES)) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      return land as 'NRW' | 'Berlin' | 'Brandenburg' | 'Sachsen';
    }
  }
  return null;
}

/** Convert (lat, lng, alt) → ENU local meters around (originLat, originLng). */
function geoToLocalENU(
  lat: number,
  lng: number,
  alt: number,
  originLat: number,
  originLng: number,
): [number, number, number] {
  const R = 6378137; // WGS84 equatorial radius in m
  const dLat = (lat - originLat) * (Math.PI / 180);
  const dLng = (lng - originLng) * (Math.PI / 180);
  // ENU: x=east, y=north, z=up. Then we swap to Y-up: (x, alt, -y) so Y=alt, Z=-y(north).
  const east = dLng * R * Math.cos((originLat * Math.PI) / 180);
  const north = dLat * R;
  // Y-up frame matching analyze-roof: x=east, y=alt, z=-north (south positive)
  return [east, alt, -north];
}

/**
 * Outset a 3D coplanar polygon by `delta` meters along each edge's
 * outward normal (proper Minkowski inflation in the polygon's 2D plane).
 *
 * Why : LOD2 polygons describe the EXACT cadastral roof boundary. But
 * placePanelsOnFace applies its inset twice (in startU/endU AND in
 * isInsetInside), so a 4-meter-wide roof gets reduced to 4 − 2*(0.3 + 0.3) = 2.8m
 * usable, which doesn't fit a single 1.879m-tall panel. By outsetting the
 * LOD2 polygon by 0.3m beforehand, the effective inset becomes exactly 0.3m.
 */
function outsetPolygon(polygon: [number, number, number][], delta: number): [number, number, number][] {
  if (polygon.length < 3) return polygon;
  // Build a 2D frame on the polygon plane (origin = centroid)
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of polygon) { cx += x; cy += y; cz += z; }
  cx /= polygon.length; cy /= polygon.length; cz /= polygon.length;
  // Plane normal via Newell
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nm = Math.hypot(nx, ny, nz) || 1;
  nx /= nm; ny /= nm; nz /= nm;
  // Tangent + bitangent
  const e0x = polygon[1][0] - polygon[0][0], e0y = polygon[1][1] - polygon[0][1], e0z = polygon[1][2] - polygon[0][2];
  const dot = e0x * nx + e0y * ny + e0z * nz;
  let tx = e0x - dot * nx, ty = e0y - dot * ny, tz = e0z - dot * nz;
  const tm = Math.hypot(tx, ty, tz) || 1;
  tx /= tm; ty /= tm; tz /= tm;
  // bitangent = normal × tangent
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  // Project to 2D (u,v) around centroid
  const pts2D = polygon.map(([x, y, z]) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    return { u: dx * tx + dy * ty + dz * tz, v: dx * bx + dy * by + dz * bz };
  });
  // Compute signed area to determine orientation (CCW = positive)
  let signedArea = 0;
  for (let i = 0; i < pts2D.length; i++) {
    const a = pts2D[i], b = pts2D[(i + 1) % pts2D.length];
    signedArea += a.u * b.v - b.u * a.v;
  }
  const ccw = signedArea > 0;
  // For each vertex, compute outward normals of its two adjacent edges,
  // average them, and push the vertex along that bisector.
  const outset2D = pts2D.map((p, i) => {
    const prev = pts2D[(i - 1 + pts2D.length) % pts2D.length];
    const next = pts2D[(i + 1) % pts2D.length];
    // Edge prev→p outward normal
    let n1u = -(p.v - prev.v), n1v = p.u - prev.u;
    let n2u = -(next.v - p.v), n2v = next.u - p.u;
    if (!ccw) { n1u = -n1u; n1v = -n1v; n2u = -n2u; n2v = -n2v; }
    const n1m = Math.hypot(n1u, n1v) || 1; n1u /= n1m; n1v /= n1m;
    const n2m = Math.hypot(n2u, n2v) || 1; n2u /= n2m; n2v /= n2m;
    let bisU = n1u + n2u, bisV = n1v + n2v;
    const bm = Math.hypot(bisU, bisV) || 1;
    // Scale so the perpendicular component along each edge normal is `delta`.
    // dot of bisector_unit with n1 = cos(half_angle); we want delta / cos(...)
    bisU /= bm; bisV /= bm;
    const cosHalf = bisU * n1u + bisV * n1v || 1e-3;
    const scale = delta / Math.max(cosHalf, 0.1); // clamp to avoid extreme spike on sharp angles
    return { u: p.u + bisU * scale, v: p.v + bisV * scale };
  });
  // Reproject back to 3D
  return outset2D.map(({ u, v }) => [
    cx + u * tx + v * bx,
    cy + u * ty + v * by,
    cz + u * tz + v * bz,
  ]);
}

/** Compute normal + area + tilt + azimuth of a 3D polygon (Y-up, alt=Y). */
function analyzeFace(polygon: [number, number, number][]): {
  normal: [number, number, number];
  area: number;
  tilt: number;
  azimuth: number;
} {
  // Newell's method for robust normal of a non-planar polygon
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const magn = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (magn < 1e-9) return { normal: [0, 1, 0], area: 0, tilt: 0, azimuth: 180 };
  nx /= magn; ny /= magn; nz /= magn;
  // Ensure normal points UP (Y > 0) — for roof surfaces, normal is upward-facing
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const area = magn / 2;
  // Tilt = angle from horizontal (Y axis). Y=1 → tilt=0; Y=0 → tilt=90.
  const tilt = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);
  // Azimuth: project (nx, nz) onto XZ plane. atan2(east, -north) → 0=N (-Z), 90=E (+X), 180=S, 270=W.
  // In our frame: x=east, z=-north → north direction is -z, south is +z.
  // atan2(nx, nz) gives angle from +Z axis (south); we want from -Z (north).
  let az = (Math.atan2(nx, -nz) * 180) / Math.PI;
  if (az < 0) az += 360;
  return { normal: [nx, ny, nz], area, tilt, azimuth: az };
}

// =============================================================================
// NRW fetcher — OGC API + CityJSON (no XML parsing, lightweight)
// =============================================================================

async function fetchNRW(
  lat: number,
  lng: number,
  bboxRadiusM = 30,  // 30m matches the geocoding precision; widening risks
                     // capturing neighbouring buildings on dense streets
): Promise<LOD2Building | null> {
  // ~30m offset in degrees: lat ≈ 0.000270°, lng ≈ 0.000425° at 50°N
  const dLat = bboxRadiusM / 111320; // m → deg lat
  const dLng = bboxRadiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');
  const url = `https://ogc-api.nrw.de/3dg/v1/collections/building/items?f=cityjson&bbox=${bbox}&limit=20`;

  let doc: CityJSONDoc;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/city+json' } });
    if (!res.ok) {
      console.warn(`[lod2-nrw] HTTP ${res.status} for bbox ${bbox}`);
      return null;
    }
    doc = (await res.json()) as CityJSONDoc;
  } catch (err) {
    console.warn(`[lod2-nrw] fetch failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!doc.CityObjects || Object.keys(doc.CityObjects).length === 0) {
    console.warn(`[lod2-nrw] no buildings in bbox ${bbox}`);
    return null;
  }

  // Decode all vertices once into real lat/lng/alt
  const { scale, translate } = doc.transform;
  const decode = (i: number): [number, number, number] => {
    const v = doc.vertices[i];
    return [
      v[0] * scale[0] + translate[0],   // lng
      v[1] * scale[1] + translate[1],   // lat
      v[2] * scale[2] + translate[2],   // alt (m)
    ];
  };

  // Find the BuildingPart closest to (lat, lng), then collect ALL its siblings
  // (BuildingParts sharing the same parent Building) — handles multi-pavilion
  // houses like Bochum where the roof is split across 2+ Solid models.
  interface PartInfo { id: string; obj: CityJSONObject; distance: number; parent?: string }
  let bestPart: PartInfo | null = null;
  const allParts: PartInfo[] = [];
  for (const [id, obj] of Object.entries(doc.CityObjects)) {
    if (obj.type !== 'BuildingPart' || !obj.geometry || obj.geometry.length === 0) continue;
    const allVerts = new Set<number>();
    for (const g of obj.geometry) {
      for (const solid of g.boundaries) {
        for (const face of solid) {
          for (const ring of face) {
            for (const idx of ring) allVerts.add(idx);
          }
        }
      }
    }
    let sumLat = 0, sumLng = 0, count = 0;
    for (const idx of allVerts) {
      const [vlng, vlat] = decode(idx);
      sumLat += vlat; sumLng += vlng; count++;
    }
    if (count === 0) continue;
    const cLat = sumLat / count;
    const cLng = sumLng / count;
    const dist = Math.hypot((cLat - lat) * 111320, (cLng - lng) * 111320 * Math.cos((lat * Math.PI) / 180));
    const parent = obj.parents?.[0];
    const info = { id, obj, distance: dist, parent };
    allParts.push(info);
    if (!bestPart || dist < bestPart.distance) bestPart = info;
  }

  if (!bestPart) {
    console.warn(`[lod2-nrw] no BuildingPart found in bbox ${bbox}`);
    return null;
  }

  // Merge siblings with same parent (multi-pavilion / multi-Solid houses)
  const siblings = bestPart.parent
    ? allParts.filter((p) => p.parent === bestPart!.parent)
    : [bestPart];
  console.log(
    `[lod2-nrw] selected BuildingPart ${bestPart.id} at ${bestPart.distance.toFixed(1)} m from target` +
      (siblings.length > 1 ? ` + ${siblings.length - 1} sibling(s)` : ''),
  );

  // Extract roof surfaces from all merged parts
  const roofSurfaces: LOD2RoofSurface[] = [];
  const allVerts3D: [number, number, number][] = [];
  for (const part of siblings) {
   for (const g of part.obj.geometry!) {
    if (g.type !== 'Solid') continue;
    const sem = g.semantics;
    if (!sem) continue;
    // boundaries[0] = the outer shell (a list of faces), per CityJSON 1.1 spec
    const shell = g.boundaries[0];
    const faceTypes = sem.values[0]; // surface index per face in this shell
    for (let fi = 0; fi < shell.length; fi++) {
      const surfaceType = sem.surfaces[faceTypes[fi]]?.type;
      if (surfaceType !== 'RoofSurface') continue;
      // Each face is [outerRing, holeRing1, ...] — take outer ring only
      const ring = shell[fi][0];
      const polygon3D: [number, number, number][] = ring.map((idx: number) => {
        const [vlng, vlat, valt] = decode(idx);
        const local = geoToLocalENU(vlat, vlng, valt, lat, lng);
        allVerts3D.push(local);
        return local;
      });
      // CityJSON often closes rings (last vertex = first); drop dup if present
      if (
        polygon3D.length > 1 &&
        polygon3D[0][0] === polygon3D[polygon3D.length - 1][0] &&
        polygon3D[0][1] === polygon3D[polygon3D.length - 1][1] &&
        polygon3D[0][2] === polygon3D[polygon3D.length - 1][2]
      ) {
        polygon3D.pop();
      }
      const { normal, area, tilt, azimuth } = analyzeFace(polygon3D);
      if (area > 0.5) {
        // Outset by 0.3m to compensate for placePanelsOnFace's double inset
        const outset = outsetPolygon(polygon3D, 0.3);
        roofSurfaces.push({ polygon: outset, normal, tilt, azimuth, area });
      }
    }
   }
  }

  // Footprint = XZ projection of all vertices, convex hull approx via min/max
  // (rough — sufficient for buildingFootprint metadata field)
  if (allVerts3D.length === 0) return null;
  const xs = allVerts3D.map((v) => v[0]);
  const zs = allVerts3D.map((v) => v[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const footprint: [number, number][] = [
    [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ],
  ];

  const totalRoofArea = roofSurfaces.reduce((s, rs) => s + rs.area, 0);
  console.log(`[lod2-nrw] ${roofSurfaces.length} roof surfaces, total ${totalRoofArea.toFixed(1)} m²`);

  return {
    source: 'NRW',
    buildingId: bestPart.id,
    footprint,
    roofSurfaces,
    totalRoofArea,
  };
}

// =============================================================================
// CityGML 1.0 parser (shared by Brandenburg + Sachsen)
// =============================================================================

/**
 * Parse a CityGML 1.0 LoD2 tile and find the Building closest to (lat, lng).
 * Returns null if no Building is found within ~50 m.
 *
 * CityGML structure (Brandenburg/Sachsen flavour):
 *   <core:CityModel>
 *     <core:cityObjectMember>
 *       <bldg:Building>
 *         <bldg:boundedBy>
 *           <bldg:RoofSurface>
 *             <bldg:lod2MultiSurface>
 *               <gml:MultiSurface>
 *                 <gml:surfaceMember>
 *                   <gml:Polygon>
 *                     <gml:exterior>
 *                       <gml:LinearRing>
 *                         <gml:posList>x1 y1 z1 x2 y2 z2 …</gml:posList>
 *
 * Coordinates are in EPSG:25833 (UTM33N) with DHHN (height above sea level).
 */
function parseCityGMLBuilding(
  parsed: unknown,
  targetLat: number,
  targetLng: number,
  source: 'Berlin' | 'Brandenburg' | 'Sachsen',
  searchRadiusM = 50,
): LOD2Building | null {
  // Convert target to UTM33N
  const [tEast, tNorth] = proj4('EPSG:4326', 'EPSG:25833', [targetLng, targetLat]);

  // Walk the parsed tree — fast-xml-parser w/ removeNSPrefix gives us
  // CityModel.cityObjectMember which can be array or object.
  const root = (parsed as Record<string, unknown>)?.CityModel as Record<string, unknown> | undefined;
  if (!root) return null;
  let members = root.cityObjectMember as unknown;
  if (!members) return null;
  if (!Array.isArray(members)) members = [members];

  let bestBuilding: { id: string; surfaces: number[][][]; centerEast: number; centerNorth: number; dist: number } | null = null;

  for (const member of members as unknown[]) {
    const m = member as Record<string, unknown>;
    const bld = m.Building as Record<string, unknown> | undefined;
    if (!bld) continue;
    const id = String((bld['@_id'] as string) ?? '');

    // Collect all RoofSurface posLists. Walk boundedBy[] (can be single or array).
    let bounded = bld.boundedBy as unknown;
    if (!bounded) continue;
    if (!Array.isArray(bounded)) bounded = [bounded];
    const roofPosLists: number[][] = [];   // each entry = flat [x,y,z,x,y,z,...] in UTM33N
    for (const b of bounded as unknown[]) {
      const bb = b as Record<string, unknown>;
      const roof = bb.RoofSurface as Record<string, unknown> | undefined;
      if (!roof) continue;
      // Walk down to gml:posList
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj.posList === 'string') {
          const flat = obj.posList.trim().split(/\s+/).map(Number);
          if (flat.length >= 9 && flat.every((n) => Number.isFinite(n))) roofPosLists.push(flat);
          return;
        }
        // Some parsers wrap text in {#text: '...'}
        const posListObj = obj.posList as Record<string, unknown> | undefined;
        if (posListObj && typeof posListObj['#text'] === 'string') {
          const flat = posListObj['#text'].trim().split(/\s+/).map(Number);
          if (flat.length >= 9 && flat.every((n) => Number.isFinite(n))) roofPosLists.push(flat);
          return;
        }
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) v.forEach(visit);
          else visit(v);
        }
      };
      visit(roof);
    }
    if (roofPosLists.length === 0) continue;

    // Compute Building centroid in UTM33N from all roof vertices
    let sumE = 0, sumN = 0, count = 0;
    for (const flat of roofPosLists) {
      for (let i = 0; i + 2 < flat.length; i += 3) {
        sumE += flat[i]; sumN += flat[i + 1]; count++;
      }
    }
    if (count === 0) continue;
    const centerEast = sumE / count;
    const centerNorth = sumN / count;
    const dist = Math.hypot(centerEast - tEast, centerNorth - tNorth);

    if (!bestBuilding || dist < bestBuilding.dist) {
      bestBuilding = {
        id,
        surfaces: roofPosLists.map((flat) => {
          const pts: number[][] = [];
          for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
          return pts;
        }),
        centerEast, centerNorth, dist,
      };
    }
  }

  if (!bestBuilding || bestBuilding.dist > searchRadiusM) {
    console.log(`[lod2-${source.toLowerCase()}] no Building within ${searchRadiusM}m (closest at ${bestBuilding?.dist.toFixed(1) ?? '?'}m)`);
    return null;
  }

  console.log(`[lod2-${source.toLowerCase()}] selected Building ${bestBuilding.id} at ${bestBuilding.dist.toFixed(1)}m, ${bestBuilding.surfaces.length} roof surface(s)`);

  // Convert each roof surface from UTM33N → WGS84 → local ENU around target
  const roofSurfaces: LOD2RoofSurface[] = [];
  const allVerts3D: [number, number, number][] = [];
  for (const surface of bestBuilding.surfaces) {
    const polygon3D: [number, number, number][] = [];
    for (const [east, north, alt] of surface) {
      const [lng, lat] = proj4('EPSG:25833', 'EPSG:4326', [east, north]);
      const local = geoToLocalENU(lat, lng, alt, targetLat, targetLng);
      polygon3D.push(local);
      allVerts3D.push(local);
    }
    // CityGML rings often close (last vertex = first); drop dup
    if (
      polygon3D.length > 1 &&
      Math.abs(polygon3D[0][0] - polygon3D[polygon3D.length - 1][0]) < 1e-6 &&
      Math.abs(polygon3D[0][1] - polygon3D[polygon3D.length - 1][1]) < 1e-6 &&
      Math.abs(polygon3D[0][2] - polygon3D[polygon3D.length - 1][2]) < 1e-6
    ) {
      polygon3D.pop();
    }
    const { normal, area, tilt, azimuth } = analyzeFace(polygon3D);
    if (area > 0.5) {
      const outset = outsetPolygon(polygon3D, 0.3);
      roofSurfaces.push({ polygon: outset, normal, tilt, azimuth, area });
    }
  }

  if (allVerts3D.length === 0) return null;
  const xs = allVerts3D.map((v) => v[0]);
  const zs = allVerts3D.map((v) => v[2]);
  const footprint: [number, number][] = [
    [Math.min(...xs), Math.min(...zs)], [Math.max(...xs), Math.min(...zs)],
    [Math.max(...xs), Math.max(...zs)], [Math.min(...xs), Math.max(...zs)],
  ];
  const totalRoofArea = roofSurfaces.reduce((s, rs) => s + rs.area, 0);

  return { source, buildingId: bestBuilding.id, footprint, roofSurfaces, totalRoofArea };
}

// =============================================================================
// Brandenburg fetcher — auto-download CityGML tiles from data.geobasis-bb.de
// =============================================================================

async function fetchBrandenburg(lat: number, lng: number): Promise<LOD2Building | null> {
  // Convert to UTM33N to find the right tile
  const [tEast, tNorth] = proj4('EPSG:4326', 'EPSG:25833', [lng, lat]);
  const tileEastKm = Math.floor(tEast / 1000);
  const tileNorthKm = Math.floor(tNorth / 1000);
  const tileName = `lod2_33${tileEastKm}-${tileNorthKm}`;
  const gmlPath = path.join(BRANDENBURG_TILES_DIR, `${tileName}_geb.gml`);

  // Check if already extracted
  let exists = await fs.stat(gmlPath).then(() => true).catch(() => false);
  if (!exists) {
    console.log(`[lod2-brandenburg] downloading tile ${tileName}.zip…`);
    await fs.mkdir(BRANDENBURG_TILES_DIR, { recursive: true });
    const zipPath = path.join(BRANDENBURG_TILES_DIR, `${tileName}.zip`);
    const url = `${BRANDENBURG_BASE_URL}/${tileName}.zip`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[lod2-brandenburg] HTTP ${res.status} for ${tileName}.zip`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(zipPath, buf);
      // Extract via unzip subprocess (avoids npm dep)
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        execFile('unzip', ['-o', zipPath, '-d', BRANDENBURG_TILES_DIR], (err) => {
          if (err) reject(err); else resolve();
        });
      });
    } catch (err) {
      console.warn(`[lod2-brandenburg] download failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
    exists = await fs.stat(gmlPath).then(() => true).catch(() => false);
    if (!exists) {
      console.warn(`[lod2-brandenburg] extraction did not produce ${gmlPath}`);
      return null;
    }
  }

  const xml = await fs.readFile(gmlPath, 'utf-8');
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  });
  const parsed = xmlParser.parse(xml);
  return parseCityGMLBuilding(parsed, lat, lng, 'Brandenburg');
}

// =============================================================================
// Berlin fetcher — auto-download CityGML tiles from gdi.berlin.de ATOM Feed
// =============================================================================
//
// Berlin uses the same CityGML 1.0 / EPSG:25833 format as Brandenburg, but:
//   - Different URL: https://gdi.berlin.de/data/a_lod2/atom/Lod2_{x}_{y}.zip
//   - Tile naming: `Lod2_{eastKm}_{northKm}.zip` (no `33` prefix, underscore not dash)
//   - XML inside ZIP: `LoD2_33_{eastKm}_{northKm}_1_BE.xml`

async function fetchBerlin(lat: number, lng: number): Promise<LOD2Building | null> {
  const [tEast, tNorth] = proj4('EPSG:4326', 'EPSG:25833', [lng, lat]);
  const tileEastKm = Math.floor(tEast / 1000);
  const tileNorthKm = Math.floor(tNorth / 1000);
  const zipName = `Lod2_${tileEastKm}_${tileNorthKm}.zip`;
  const xmlName = `LoD2_33_${tileEastKm}_${tileNorthKm}_1_BE.xml`;
  const xmlPath = path.join(BERLIN_TILES_DIR, xmlName);

  let exists = await fs.stat(xmlPath).then(() => true).catch(() => false);
  if (!exists) {
    console.log(`[lod2-berlin] downloading tile ${zipName}…`);
    await fs.mkdir(BERLIN_TILES_DIR, { recursive: true });
    const zipPath = path.join(BERLIN_TILES_DIR, zipName);
    const url = `${BERLIN_BASE_URL}/${zipName}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (reonic-hackathon)' } });
      if (!res.ok) {
        console.warn(`[lod2-berlin] HTTP ${res.status} for ${zipName}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(zipPath, buf);
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        execFile('unzip', ['-o', zipPath, '-d', BERLIN_TILES_DIR], (err) => {
          if (err) reject(err); else resolve();
        });
      });
    } catch (err) {
      console.warn(`[lod2-berlin] download failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
    exists = await fs.stat(xmlPath).then(() => true).catch(() => false);
    if (!exists) {
      console.warn(`[lod2-berlin] extraction did not produce ${xmlPath}`);
      return null;
    }
  }

  const xml = await fs.readFile(xmlPath, 'utf-8');
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  });
  const parsed = xmlParser.parse(xml);
  return parseCityGMLBuilding(parsed, lat, lng, 'Berlin');
}

// =============================================================================
// Sachsen fetcher — offline CityGML tile cache
// =============================================================================

async function fetchSachsen(lat: number, lng: number): Promise<LOD2Building | null> {
  // Sachsen LOD2 tiles use UTM Zone 33N (EPSG:25833) with 2km × 2km tiles.
  // Tile naming convention: {easting_km}_{northing_km}.gml or similar.
  // Without an API, we look in data/lod2-sachsen/ for any *.gml or *.xml file
  // whose filename contains the rounded UTM coords of the target.

  const exists = await fs
    .stat(SACHSEN_TILES_DIR)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    console.log(
      `[lod2-sachsen] tile dir ${SACHSEN_TILES_DIR} not found — manually download tiles from https://www.geodaten.sachsen.de/batch-download-4719.html`,
    );
    return null;
  }

  // Naive: read all .gml files in the dir and try to find a Building near the target.
  // Acceptable for the hackathon — production would index by tile bbox.
  const files = await fs.readdir(SACHSEN_TILES_DIR);
  const gmlFiles = files.filter((f) => f.endsWith('.gml') || f.endsWith('.xml'));
  if (gmlFiles.length === 0) {
    console.log(`[lod2-sachsen] no .gml files in ${SACHSEN_TILES_DIR} — please download tiles`);
    return null;
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  });

  for (const file of gmlFiles) {
    try {
      const xml = await fs.readFile(path.join(SACHSEN_TILES_DIR, file), 'utf-8');
      const parsed = xmlParser.parse(xml);
      const building = parseCityGMLBuilding(parsed, lat, lng, 'Sachsen');
      if (building) {
        console.log(`[lod2-sachsen] found building in ${file}`);
        return building;
      }
    } catch (err) {
      console.warn(`[lod2-sachsen] parse error in ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`[lod2-sachsen] no building near (${lat}, ${lng}) in cached tiles`);
  return null;
}

// =============================================================================
// Public entry point
// =============================================================================

export async function fetchLOD2Building(lat: number, lng: number, houseId?: string): Promise<LOD2Building | null> {
  // Cache lookup
  if (houseId) {
    const cachePath = path.join(CACHE_DIR, `${houseId}-lod2.json`);
    try {
      const cached = await fs.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(cached);
      if (parsed && parsed._null) return null;
      return parsed as LOD2Building;
    } catch {
      // miss → continue
    }
  }

  const land = detectLand(lat, lng);
  if (!land) {
    console.log(`[lod2] (${lat}, ${lng}) not in any covered Land (NRW, Sachsen)`);
    return null;
  }

  let building: LOD2Building | null = null;
  if (land === 'NRW') {
    // Progressive bbox widening: 30m matches geocoding precision but misses
    // when the address point is just outside the building footprint (e.g. on
    // a driveway or shared cadastral boundary — meerbusch case). Try 60m as
    // a fallback. Cap at 60m: 100m+ starts capturing neighbours on dense
    // streets and produces multi-pavilion confusion (e.g. koeln2).
    building = await fetchNRW(lat, lng);
    if (!building) {
      console.log('[lod2-nrw] retry with 60 m bbox…');
      building = await fetchNRW(lat, lng, 60);
    }
  } else if (land === 'Berlin') {
    building = await fetchBerlin(lat, lng);
  } else if (land === 'Brandenburg') {
    building = await fetchBrandenburg(lat, lng);
  } else if (land === 'Sachsen') {
    building = await fetchSachsen(lat, lng);
  }

  // Cache result (including null misses to avoid re-fetching)
  if (houseId) {
    const cachePath = path.join(CACHE_DIR, `${houseId}-lod2.json`);
    await fs.writeFile(cachePath, JSON.stringify(building ?? { _null: true }, null, 2));
  }

  return building;
}
