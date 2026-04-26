// POST /api/design — OWNED by Dev B (BOM + sizing), partially implemented by Dev D
// for the roof-area portion (so isJumelee /2 division flows through end-to-end).
//
// Two input modes supported:
//   1. By houseId (legacy): { houseId: 'bench-berlin1', profile: {...} }
//   2. By GPS coords: { lat: 52.4530, lng: 13.2868, profile: {...} }
//      → looks up the closest pre-baked house within MATCH_RADIUS_M.
//
// Output: DesignResult including modulesMax (panel count from algo).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { CustomerProfile, HouseId, RoofGeometry } from '@/lib/types';

// Module power density: ~180 W per m² of roof for monocrystalline panels.
const PV_DENSITY_KW_PER_SQM = 0.18;
// Industry-standard module surface (Hanwha Q.Peak 400W class) — must match
// place-panels.ts.
const MODULE_AREA_SQM = 1.045 * 1.879;
// Max distance (meters) between request lat/lng and a pre-baked house
// for the lookup to succeed. Beyond this → 404 "no analysis available".
const MATCH_RADIUS_M = 50;
const BAKED_DIR = path.join(process.cwd(), 'public/baked');

interface PrebakedHouse {
  houseId: string;
  lat: number;
  lng: number;
}

/** Haversine distance in meters between two lat/lng pairs. */
function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Scan public/baked/ for *-photogrammetry.json files and read their JSON
 * headers (just first ~200 bytes — enough to capture the {houseId, lat, lng}
 * preamble). Cached for the lifetime of the Node process via module-level let.
 */
let prebakedCache: PrebakedHouse[] | null = null;
async function listPrebakedHouses(): Promise<PrebakedHouse[]> {
  if (prebakedCache) return prebakedCache;
  const files = await fs.readdir(BAKED_DIR).catch(() => []);
  const photoFiles = files.filter((f) => f.endsWith('-photogrammetry.json'));
  const houses: PrebakedHouse[] = [];
  for (const f of photoFiles) {
    try {
      const fd = await fs.open(path.join(BAKED_DIR, f), 'r');
      const buf = Buffer.alloc(512);
      try { await fd.read(buf, 0, 512, 0); } finally { await fd.close(); }
      const head = buf.toString('utf-8');
      const idMatch = head.match(/"houseId"\s*:\s*"([^"]+)"/);
      const latMatch = head.match(/"lat"\s*:\s*([-\d.]+)/);
      const lngMatch = head.match(/"lng"\s*:\s*([-\d.]+)/);
      if (idMatch && latMatch && lngMatch) {
        houses.push({
          houseId: idMatch[1],
          lat: parseFloat(latMatch[1]),
          lng: parseFloat(lngMatch[1]),
        });
      }
    } catch {
      // skip unreadable files
    }
  }
  prebakedCache = houses;
  return houses;
}

/** Find the closest pre-baked house within MATCH_RADIUS_M, or null. */
async function findClosestHouse(
  lat: number,
  lng: number,
): Promise<{ house: PrebakedHouse; distanceM: number } | null> {
  const houses = await listPrebakedHouses();
  let best: { house: PrebakedHouse; distanceM: number } | null = null;
  for (const h of houses) {
    const d = haversineDistanceM(lat, lng, h.lat, h.lng);
    if (!best || d < best.distanceM) best = { house: h, distanceM: d };
  }
  return best && best.distanceM <= MATCH_RADIUS_M ? best : null;
}

interface DesignRequestBody {
  profile: CustomerProfile;
  houseId?: HouseId;
  lat?: number;
  lng?: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as DesignRequestBody;
  const { profile, houseId: requestedHouseId, lat, lng } = body;

  // Resolve houseId — either passed directly, or looked up from GPS coords.
  let houseId: string;
  let matchedDistanceM: number | null = null;
  if (requestedHouseId) {
    houseId = requestedHouseId;
  } else if (typeof lat === 'number' && typeof lng === 'number') {
    const match = await findClosestHouse(lat, lng);
    if (!match) {
      const all = await listPrebakedHouses();
      return NextResponse.json(
        {
          error: `No pre-baked analysis within ${MATCH_RADIUS_M}m of (${lat}, ${lng}). Run pnpm bake:fetch + bake:analyze:multi for this address first.`,
          knownHouseCount: all.length,
        },
        { status: 404 },
      );
    }
    houseId = match.house.houseId;
    matchedDistanceM = Math.round(match.distanceM * 10) / 10;
  } else {
    return NextResponse.json(
      { error: 'Request must include either `houseId` OR (`lat` AND `lng`).' },
      { status: 400 },
    );
  }

  // 1. Load roof analysis (output of analyze-roof.ts).
  const analysisPath = path.join(BAKED_DIR, `${houseId}-analysis.json`);
  let analysis: RoofGeometry;
  try {
    const raw = await fs.readFile(analysisPath, 'utf-8');
    analysis = JSON.parse(raw) as RoofGeometry;
  } catch (err) {
    return NextResponse.json(
      { error: `analysis JSON not found for ${houseId}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 404 },
    );
  }

  // 2. Read pre-baked summary fields (or recompute as fallback for older JSONs).
  //    isJumelee (Doppelhaus / semi-detached) means the OSM building polygon
  //    covers BOTH halves of a shared roof → user only owns half of the surface.
  const houseShareDivisor = profile.isJumelee ? 2 : 1;
  const a = analysis as RoofGeometry & {
    modulesMax?: number;
    modulesMaxAreaSqm?: number;
    roofTotalAreaSqm?: number;
    roofUsableAreaSqm?: number;
  };
  const roofTotalAreaSqm =
    a.roofUsableAreaSqm ??
    analysis.faces.reduce((sum, f) => sum + f.usableArea, 0);
  const roofAttributedAreaSqm = roofTotalAreaSqm / houseShareDivisor;
  const roofMaxKwp = roofAttributedAreaSqm * PV_DENSITY_KW_PER_SQM;

  const modulesPlacedRaw = a.modulesMax ?? analysis.modulePositions?.length ?? 0;
  const modulesMax = Math.floor(modulesPlacedRaw / houseShareDivisor);
  const modulesMaxAreaSqm = modulesMax * MODULE_AREA_SQM;

  // 4-8. TODO Dev B: predictBomViaPioneer, k-NN similars, financials, etc.
  return NextResponse.json({
    _partial: true,
    _todo: 'Dev B: BOM + sizing + financials',
    houseId,
    matchedFromCoords: matchedDistanceM !== null
      ? { lat, lng, distanceM: matchedDistanceM }
      : null,
    isJumelee: profile.isJumelee,
    roofTotalAreaSqm: Math.round(roofTotalAreaSqm * 10) / 10,
    roofAttributedAreaSqm: Math.round(roofAttributedAreaSqm * 10) / 10,
    roofMaxKwp: Math.round(roofMaxKwp * 100) / 100,
    modulesMax,
    modulesMaxAreaSqm: Math.round(modulesMaxAreaSqm * 10) / 10,
    faceCount: analysis.faces.length,
    obstructionCount: analysis.obstructions.length,
  });
}
