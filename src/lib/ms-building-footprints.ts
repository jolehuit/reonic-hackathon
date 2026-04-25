// Microsoft Global ML Building Footprints — fallback polygon source when OSM
// is incomplete (Reihenhäuser where OSM stops at the wall and misses eaves).
//
// Data: https://github.com/microsoft/GlobalMLBuildingFootprints
// Format: per-quadkey (zoom 9) gzipped CSV with columns:
//   latitude, longitude, area_in_meters, confidence, geometry (WKT POLYGON)
//
// Pipeline:
//   1. Compute quadkey for (lat, lng) at zoom 9
//   2. Look up the file URL from dataset-links.csv (cached)
//   3. Download + cache the per-quadkey CSV.gz (~50-200 MB once)
//   4. Stream-parse the CSV, keep buildings within ~50 m of the address
//   5. Return the closest polygon as { lat, lng } pairs

import { promises as fs } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data/ms-footprints');
const DATASET_LINKS_URL = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';
const SEARCH_RADIUS_M = 50;

interface DatasetLink {
  location: string;
  quadkey: string;
  url: string;
  size: number;
}

/** Compute Bing Maps quadkey for a (lat, lng) at given zoom level. */
export function latLngToQuadkey(lat: number, lng: number, zoom = 9): string {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = (lng + 180) / 360;
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  const tileX = Math.floor(x * Math.pow(2, zoom));
  const tileY = Math.floor(y * Math.pow(2, zoom));
  let key = '';
  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((tileX & mask) !== 0) digit |= 1;
    if ((tileY & mask) !== 0) digit |= 2;
    key += digit.toString();
  }
  return key;
}

async function loadDatasetLinks(): Promise<DatasetLink[]> {
  const cachePath = path.join(DATA_DIR, 'dataset-links.csv');
  let csv: string;
  try {
    csv = await fs.readFile(cachePath, 'utf-8');
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`[ms-footprints] downloading dataset-links.csv…`);
    const resp = await fetch(DATASET_LINKS_URL);
    if (!resp.ok) throw new Error(`MS dataset-links fetch failed ${resp.status}`);
    csv = await resp.text();
    await fs.writeFile(cachePath, csv);
  }
  const lines = csv.split('\n').slice(1).filter((l) => l.trim());
  return lines.map((l) => {
    const [location, quadkey, url, size] = l.split(',');
    return { location, quadkey, url, size: parseInt(size, 10) || 0 };
  });
}

async function downloadQuadkeyFile(url: string, quadkey: string): Promise<string> {
  const cachePath = path.join(DATA_DIR, `${quadkey}.csv.gz`);
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {
    /* not cached, fall through to download */
  }
  console.log(`[ms-footprints] downloading ${url} (cache miss for quadkey ${quadkey})…`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MS quadkey fetch failed ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(cachePath, buf);
  console.log(`[ms-footprints] cached ${(buf.length / 1024 / 1024).toFixed(1)} MB at ${cachePath}`);
  return cachePath;
}

/** Parse a GeoJSON Feature line, return polygon as {lat, lng} pairs. */
function parseGeoJsonLine(line: string): { lat: number; lng: number }[] | null {
  let f: { geometry?: { type?: string; coordinates?: number[][][] } };
  try { f = JSON.parse(line); } catch { return null; }
  if (f.geometry?.type !== 'Polygon' || !f.geometry.coordinates?.[0]) return null;
  return f.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
}

function distLatLngM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  // Equirectangular cheap approximation for small distances.
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const meanLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const x = dLng * Math.cos(meanLat);
  return R * Math.hypot(dLat, x);
}

function polygonCentroid(poly: { lat: number; lng: number }[]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const p of poly) { lat += p.lat; lng += p.lng; }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

export interface MSFootprintResult {
  polygon: { lat: number; lng: number }[];
  centroid: { lat: number; lng: number };
  centroidDistM: number;
  approxAreaM2: number;
  containsTarget: boolean;
}

/** Fetch the building polygon nearest to (lat, lng) from MS Footprints. */
export async function fetchMSBuildingFootprint(
  lat: number,
  lng: number,
): Promise<MSFootprintResult | null> {
  const target = { lat, lng };
  const quadkey = latLngToQuadkey(lat, lng, 9);

  const links = await loadDatasetLinks();
  const link = links.find((l) => l.quadkey === quadkey);
  if (!link) {
    console.warn(`[ms-footprints] no dataset link for quadkey ${quadkey}`);
    return null;
  }

  const filePath = await downloadQuadkeyFile(link.url, quadkey);

  // Stream-parse: each row has lat,lng,area,confidence,WKT-polygon.
  const stream = (await fs.open(filePath)).createReadStream();
  const gunzip = createGunzip();
  const rl = createInterface({ input: stream.pipe(gunzip) });

  let best: MSFootprintResult | null = null;
  let bestScore = Infinity;

  // Pre-filter via bounding box on lat/lng (approx 50 m → 0.00045°).
  const LAT_PADDING = SEARCH_RADIUS_M / 111000;
  const LNG_PADDING = SEARCH_RADIUS_M / (111000 * Math.cos((lat * Math.PI) / 180));
  const latMin = lat - LAT_PADDING;
  const latMax = lat + LAT_PADDING;
  const lngMin = lng - LNG_PADDING;
  const lngMax = lng + LNG_PADDING;

  for await (const line of rl) {
    if (!line.trim()) continue;
    // Cheap bbox prefilter — match the first vertex inside "coordinates": [[[lng, lat]
    // (note the optional whitespace around `[`).
    const m = line.match(/"coordinates"\s*:\s*\[\s*\[\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    if (m) {
      const lngFirst = parseFloat(m[1]);
      const latFirst = parseFloat(m[2]);
      if (latFirst < latMin - 0.001 || latFirst > latMax + 0.001 ||
          lngFirst < lngMin - 0.001 || lngFirst > lngMax + 0.001) continue;
    } else {
      continue;
    }
    const polygon = parseGeoJsonLine(line);
    if (!polygon || polygon.length < 3) continue;

    const centroid = polygonCentroid(polygon);
    const dist = distLatLngM(target, centroid);
    if (dist > SEARCH_RADIUS_M) continue;

    if (dist < bestScore) {
      // Approximate area via shoelace in local meters.
      let s = 0;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = (polygon[i].lng - centroid.lng) * 111000 * Math.cos((centroid.lat * Math.PI) / 180);
        const yi = (polygon[i].lat - centroid.lat) * 111000;
        const xj = (polygon[j].lng - centroid.lng) * 111000 * Math.cos((centroid.lat * Math.PI) / 180);
        const yj = (polygon[j].lat - centroid.lat) * 111000;
        s += (xj * yi - xi * yj);
      }
      const approxAreaM2 = Math.abs(s / 2);
      const containsTarget = pointInLatLngPolygon(target, polygon);
      bestScore = dist;
      best = { polygon, centroid, centroidDistM: dist, approxAreaM2, containsTarget };
    }
  }
  return best;
}

function pointInLatLngPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}
