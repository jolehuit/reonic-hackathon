// OSM footprint source — OWNED by Dev A, server-side only
// Queries Overpass API for the building closest to the input lat/lng,
// returns its real cadastral polygon, dimensions, and any tagged metadata
// (levels, height, roof shape, material).
//
// Used to constrain Gemini's vision output: instead of letting the AI
// estimate dimensions from blurry Street View photos, we feed it the
// actual building footprint from OpenStreetMap.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SEARCH_RADIUS_M = 30;

export interface OsmBuilding {
  osmId: number;
  /** Polygon in [lng, lat] order, closed (first === last). */
  polygonLngLat: [number, number][];
  /** Polygon in mesh-local meters [[x_east, z_south], ...] centered on the address. */
  polygonMeshXZ: [number, number][];
  /** East-west extent in meters. */
  widthM: number;
  /** North-south extent in meters. */
  depthM: number;
  /** Centroid offset (in meters) from the input lat/lng to the building center. */
  centroidOffsetM: { east: number; north: number };
  tags: {
    building?: string;
    levels?: number;
    height?: number;
    roofShape?: string;
    roofMaterial?: string;
  };
}

export async function fetchClosestBuilding(
  lat: number,
  lng: number,
): Promise<OsmBuilding | null> {
  const query = `[out:json];way(around:${SEARCH_RADIUS_M},${lat},${lng})["building"];out body geom;`;

  let resp: Response;
  try {
    resp = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: OverpassResponse;
  try {
    data = (await resp.json()) as OverpassResponse;
  } catch {
    return null;
  }

  const candidates = (data.elements ?? []).filter(
    (e) => e.geometry && e.geometry.length >= 3,
  );
  if (candidates.length === 0) return null;

  // Rank by centroid distance to target.
  const ranked = candidates
    .map((b) => {
      const c = centroid(b.geometry!);
      return { b, c, dist: haversineM({ lat, lng }, c) };
    })
    .sort((a, b) => a.dist - b.dist);

  const { b, c } = ranked[0];
  const geom = b.geometry!;

  // BBox in meters at the local latitude.
  const lats = geom.map((p) => p.lat);
  const lngs = geom.map((p) => p.lon);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * cosLat;
  const depthM = (Math.max(...lats) - Math.min(...lats)) * 111320;

  // Polygon in mesh-local meters (origin = input lat/lng, x = east, z = south).
  const polygonLngLat: [number, number][] = geom.map((p) => [p.lon, p.lat]);
  const polygonMeshXZ: [number, number][] = geom.map((p) => [
    (p.lon - lng) * 111320 * cosLat,
    -(p.lat - lat) * 111320,
  ]);

  const tags = b.tags ?? {};

  return {
    osmId: b.id,
    polygonLngLat,
    polygonMeshXZ,
    widthM,
    depthM,
    centroidOffsetM: {
      east: (c.lng - lng) * 111320 * cosLat,
      north: (c.lat - lat) * 111320,
    },
    tags: {
      building: tags.building,
      levels: tags['building:levels'] ? parseInt(tags['building:levels'], 10) : undefined,
      height: tags.height ? parseFloat(tags.height) : undefined,
      roofShape: tags['roof:shape'],
      roofMaterial: tags['roof:material'],
    },
  };
}

interface OverpassResponse {
  elements?: Array<{
    id: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

function centroid(geom: { lat: number; lon: number }[]): { lat: number; lng: number } {
  const lat = geom.reduce((s, p) => s + p.lat, 0) / geom.length;
  const lng = geom.reduce((s, p) => s + p.lon, 0) / geom.length;
  return { lat, lng };
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
