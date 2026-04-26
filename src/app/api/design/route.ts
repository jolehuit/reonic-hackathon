// POST /api/design — OWNED by Dev B (BOM + sizing), partially implemented by Dev D
// for the roof-area portion (so isJumelee /2 division flows through end-to-end).
//
// Two input modes supported:
//   1. By houseId (legacy): { houseId: 'bench-berlin1', profile: {...} }
//   2. By GPS coords: { lat: 52.4530, lng: 13.2868, profile: {...} }
//      → looks up the closest pre-baked house within MATCH_RADIUS_M.
//      → if cache miss: spawns bake:fetch + bake:analyze:multi live (~3-5min).
//        Set DISABLE_LIVE_FETCH=1 to disable on-demand fetching.
//
// Output: DesignResult including modulesMax (panel count from algo).

// Long-running route (live fetch+analyze can take 3-5 min). Force dynamic so
// Next.js doesn't try to cache or pre-render.
export const dynamic = 'force-dynamic';
export const maxDuration = 600;  // seconds (Next 14+ on Vercel; ignored locally)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
 * headers (just first ~512 bytes — enough to capture the {houseId, lat, lng}
 * preamble). Cached for the lifetime of the Node process.
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

/**
 * Run a child process to completion, capturing stdout/stderr in memory.
 * Resolves with the exit code; rejects if the process can't be spawned.
 */
function runChild(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastLine = '';
    child.stdout?.on('data', (d) => { lastLine = d.toString().trim().split('\n').pop() ?? lastLine; });
    child.stderr?.on('data', (d) => { lastLine = d.toString().trim().split('\n').pop() ?? lastLine; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) console.warn(`[runChild] ${cmd} ${args.join(' ')} exit ${code}: ${lastLine}`);
      resolve(code ?? 0);
    });
  });
}

/**
 * Live mode: fetch 3D tiles for {lat, lng}, then run multi-variant analysis.
 * Returns the houseId used (live-{shortHash}) on success, or throws.
 *
 * Cost: ~30-60s tile fetch + ~2-4min analysis (22 variants in parallel internally).
 * Use only when the user explicitly opts in or when cache miss is acceptable.
 */
async function fetchAndAnalyzeLive(lat: number, lng: number): Promise<string> {
  // Stable ID from coords (6-digit precision = ~10cm)
  const liveId = `live-${lat.toFixed(6).replace('.', '_')}-${lng.toFixed(6).replace('.', '_')}`;
  const photoPath = path.join(BAKED_DIR, `${liveId}-photogrammetry.json`);
  const analysisPath = path.join(BAKED_DIR, `${liveId}-analysis.json`);

  // Skip fetch if already done (e.g., previous live request)
  const photoExists = await fs.stat(photoPath).then(() => true).catch(() => false);
  if (!photoExists) {
    console.log(`[live] fetching 3D tiles for ${liveId} at (${lat}, ${lng})…`);
    const code = await runChild('pnpm', ['bake:fetch'], {
      LIVE_HOUSE_ID: liveId,
      LIVE_LAT: String(lat),
      LIVE_LNG: String(lng),
    });
    if (code !== 0) throw new Error(`bake:fetch exited ${code}`);
  }

  const analysisExists = await fs.stat(analysisPath).then(() => true).catch(() => false);
  if (!analysisExists) {
    console.log(`[live] running multi-variant analysis for ${liveId}…`);
    const code = await runChild('pnpm', ['bake:analyze:multi', liveId]);
    if (code !== 0) throw new Error(`bake:analyze:multi exited ${code}`);
  }

  // Bust the prebaked cache so this new house shows up in subsequent requests
  prebakedCache = null;
  return liveId;
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
    if (match) {
      houseId = match.house.houseId;
      matchedDistanceM = Math.round(match.distanceM * 10) / 10;
    } else {
      // Cache miss → fetch 3D tiles + run analyze pipeline live (~3-5min).
      // Honour env flag to disable on-demand fetching (e.g., in CI / read-only).
      if (process.env.DISABLE_LIVE_FETCH === '1') {
        const all = await listPrebakedHouses();
        return NextResponse.json(
          {
            error: `No pre-baked analysis within ${MATCH_RADIUS_M}m of (${lat}, ${lng}); live fetch disabled.`,
            knownHouseCount: all.length,
          },
          { status: 404 },
        );
      }
      try {
        houseId = await fetchAndAnalyzeLive(lat, lng);
        matchedDistanceM = 0;
      } catch (err) {
        return NextResponse.json(
          {
            error: `Live fetch+analyze failed for (${lat}, ${lng}): ${err instanceof Error ? err.message : String(err)}`,
          },
          { status: 502 },
        );
      }
    }
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

  // 2. Compute roof surface and apply the user's house-share divisor.
  //    isJumelee (Doppelhaus / semi-detached) means the OSM building polygon
  //    covers BOTH halves of a shared roof → user only owns half of the surface.
  const houseShareDivisor = profile.isJumelee ? 2 : 1;
  const roofTotalAreaSqm = analysis.faces.reduce((sum, f) => sum + f.usableArea, 0);
  const roofAttributedAreaSqm = roofTotalAreaSqm / houseShareDivisor;
  const roofMaxKwp = roofAttributedAreaSqm * PV_DENSITY_KW_PER_SQM;

  // 3. Panel count from the algorithm (post-variant selection + LOD2 fallback).
  const modulesPlaced = analysis.modulePositions?.length ?? 0;
  const modulesMax = Math.floor(modulesPlaced / houseShareDivisor);
  const modulesMaxAreaSqm = Math.round(modulesMax * MODULE_AREA_SQM * 10) / 10;

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
    modulesMaxAreaSqm,
    faceCount: analysis.faces.length,
    obstructionCount: analysis.obstructions.length,
  });
}
