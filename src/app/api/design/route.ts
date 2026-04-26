// POST /api/design — OWNED by Dev B (with live geometry from Dev D's pipeline).
//
// Two input modes:
//   1. By houseId (demo): { houseId: 'berlin-dahlem', profile }
//      → reads public/baked/{houseId}-analysis.json (already on disk).
//   2. By GPS coords (live): { lat, lng, profile }
//      → looks up the closest pre-baked house within MATCH_RADIUS_M.
//      → if cache miss: spawns the bake pipeline live (~3–5 min) so the
//        request always returns a real analysis. Disable with
//        DISABLE_LIVE_FETCH=1 (CI / read-only).
//
// Output: complete DesignResult — k-NN sizing on the customer profile +
// financials + the modulePositions actually placed by Dev D's algorithm.
// `analysis.modulesMax` is the single source of truth for the panel count
// the roof can physically host; k-NN's kWp suggestion is plafonné by it
// instead of the older opaque `usableArea × efficiency` heuristic.

// Long-running route (live fetch+analyze can take 3–5 min). Force dynamic
// so Next doesn't try to cache or pre-render.
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // seconds (Next on Vercel; ignored locally)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

import { recommendSystem } from '@/lib/sizing';
import { computeFinancials } from '@/lib/financials';
import { defaultCustomerProfile } from '@/lib/customRoof';
import type {
  CustomerProfile,
  DesignResult,
  HouseId,
  RoofGeometry,
} from '@/lib/types';

const MODULE_WATT_PEAK = 475;
const MODULE_BRAND: 'AIKO' | 'Trina' = 'AIKO';
const INVERTER_MODEL = 'SMA Tripower X';
const BATTERY_BRAND = 'BYD HVS';
const HEATPUMP_MODEL = 'Viessmann Vitocal 250-A';

// Max distance in meters between request lat/lng and a pre-baked house
// for the lookup to succeed. Beyond this → live fetch (or 404 if disabled).
const MATCH_RADIUS_M = 50;
const BAKED_DIR = path.join(process.cwd(), 'public', 'baked');

interface DesignRequestBody {
  houseId?: HouseId | 'custom';
  profile?: CustomerProfile;
  lat?: number;
  lng?: number;
  address?: string;
}

// ── GPS → houseId lookup ────────────────────────────────────────────────

interface PrebakedHouse {
  houseId: string;
  lat: number;
  lng: number;
}

/** Haversine great-circle distance in meters. */
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

/** Scan public/baked/ for *-photogrammetry.json headers, extracting
 *  { houseId, lat, lng } from each. Cached for the Node process lifetime. */
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

// ── Live fetch + analyze on cache miss ──────────────────────────────────

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

/** Fetch 3D tiles for {lat, lng}, then run multi-variant analysis. Returns
 *  the stable houseId (live-{lat6}-{lng6}) used for caching. ~30-60s tile
 *  fetch + ~2-4min analysis. */
async function fetchAndAnalyzeLive(lat: number, lng: number): Promise<string> {
  const liveId = `live-${lat.toFixed(6).replace('.', '_')}-${lng.toFixed(6).replace('.', '_')}`;
  const photoPath = path.join(BAKED_DIR, `${liveId}-photogrammetry.json`);
  const analysisPath = path.join(BAKED_DIR, `${liveId}-analysis.json`);

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

  // Bust the cache so the new house surfaces in the next lookup.
  prebakedCache = null;
  return liveId;
}

async function loadBakedGeometry(houseId: string): Promise<RoofGeometry> {
  const filePath = path.join(BAKED_DIR, `${houseId}-analysis.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as RoofGeometry;
}

// ── Roof capacity → kWp ceiling ─────────────────────────────────────────

/** The roof's physical capacity in kWp. Prefer `analysis.modulesMax` (the
 *  count Dev D's algorithm actually placed after variant selection) over
 *  the older `usableArea × efficiency` heuristic — modulesMax already
 *  accounts for orientation, obstructions, edge offsets, etc. */
function roofMaxKwp(roof: RoofGeometry, isJumelee: boolean): number {
  const divisor = isJumelee ? 2 : 1;
  if (typeof roof.modulesMax === 'number' && roof.modulesMax > 0) {
    return (roof.modulesMax * MODULE_WATT_PEAK) / 1000 / divisor;
  }
  // Fallback for legacy analysis.json without top-level modulesMax —
  // approximate from modulePositions length, then from south-face usable
  // area × 0.18 efficiency.
  if (roof.modulePositions && roof.modulePositions.length > 0) {
    return (roof.modulePositions.length * MODULE_WATT_PEAK) / 1000 / divisor;
  }
  const PANEL_EFFICIENCY = 0.18;
  const south = roof.faces.filter((f) => f.azimuth > 90 && f.azimuth < 270);
  const raw =
    south.reduce((s, f) => s + f.usableArea * PANEL_EFFICIENCY, 0) ||
    roof.faces.reduce((s, f) => s + f.usableArea * PANEL_EFFICIENCY, 0);
  return raw / divisor;
}

// ── Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = performance.now();

  let body: DesignRequestBody;
  try {
    body = (await req.json()) as DesignRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 1. Resolve houseId. Two paths now (synthetic geometry has been removed):
  //    (a) demo houseId in the request → straight to baked file
  //    (b) lat/lng (with optional houseId='custom') → try GPS lookup first,
  //        then run the live pipeline (3-5 min) on cache miss
  let resolvedHouseId: string;
  let matchedDistanceM: number | null = null;

  const requestedHouseId = body.houseId;
  const { lat, lng } = body;

  if (requestedHouseId && requestedHouseId !== 'custom') {
    resolvedHouseId = requestedHouseId;
  } else if (typeof lat === 'number' && typeof lng === 'number') {
    const match = await findClosestHouse(lat, lng);
    if (match) {
      resolvedHouseId = match.house.houseId;
      matchedDistanceM = Math.round(match.distanceM * 10) / 10;
    } else if (process.env.DISABLE_LIVE_FETCH === '1') {
      return NextResponse.json(
        { error: `No pre-baked analysis within ${MATCH_RADIUS_M}m of (${lat}, ${lng}); live fetch disabled.` },
        { status: 404 },
      );
    } else {
      try {
        resolvedHouseId = await fetchAndAnalyzeLive(lat, lng);
      } catch (err) {
        return NextResponse.json(
          { error: `Live pipeline failed for (${lat}, ${lng}): ${err instanceof Error ? err.message : String(err)}` },
          { status: 502 },
        );
      }
    }
  } else {
    return NextResponse.json(
      { error: 'Request must include either `houseId` or (`lat` and `lng`).' },
      { status: 400 },
    );
  }

  // 2. Resolve profile. Default seeded to German residential median when
  //    the client hasn't filled the manual form yet.
  const profile: CustomerProfile = body.profile ?? defaultCustomerProfile();

  // 3. Load baked geometry for the resolved house.
  let roof: RoofGeometry;
  try {
    roof = await loadBakedGeometry(resolvedHouseId);
  } catch {
    return NextResponse.json(
      { error: `No analysis.json for house "${resolvedHouseId}"` },
      { status: 404 },
    );
  }

  // 4. Roof capacity → k-NN cap.
  const ceilingKwp = roofMaxKwp(roof, profile.isJumelee);

  // 5. k-NN sizing on the 1620 Reonic projects.
  const reco = await recommendSystem(profile, ceilingKwp);

  // 6. Module count = round(kWp / 475W), clamped to physical roof capacity.
  const baseModulePositions = roof.modulePositions ?? [];
  const physicalMax = roof.modulesMax ?? baseModulePositions.length;
  const knnCount = Math.max(1, Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK));
  const moduleCount = physicalMax > 0 ? Math.min(knnCount, physicalMax) : knnCount;

  // Slice positions to match. If positions exist but were already capped
  // by the bake step (modulesMax === modulePositions.length), this is a
  // simple .slice; otherwise (legacy files) we just take what's there.
  const modulePositions = baseModulePositions.length > 0
    ? baseModulePositions.slice(0, moduleCount)
    : [];

  // Effective totalKwp matches the panel count we'll actually ship — so
  // the customer's "8.6 kWp" headline matches the panels rendered in 3D.
  const effectiveTotalKwp = Math.round((moduleCount * MODULE_WATT_PEAK) / 1000 * 100) / 100;
  const inverterPowerKw = Math.max(1, Math.ceil(effectiveTotalKwp * 0.85));

  // 7. Financials. Use effectiveTotalKwp (post-cap) so price scales with
  //    actual installed capacity. hasWallbox follows hasEv on the server
  //    (default), but the client recomputes via useEffectiveDesign so the
  //    user's refinement toggle is what really matters end-to-end.
  const fin = computeFinancials({
    totalKwp: effectiveTotalKwp,
    batteryKwh: reco.batteryCapacityKwh,
    heatPumpKw: reco.heatPumpNominalPowerKw,
    hasWallbox: profile.hasEv,
    annualConsumptionKwh: profile.annualConsumptionKwh,
    hasEv: profile.hasEv,
  });

  const result: DesignResult & { matchedFromCoords?: { lat: number; lng: number; distanceM: number } } = {
    moduleCount,
    moduleBrand: MODULE_BRAND,
    moduleWattPeak: MODULE_WATT_PEAK,
    totalKwp: effectiveTotalKwp,
    modulePositions,

    inverterModel: INVERTER_MODEL,
    inverterPowerKw,
    inverterLoadPercent: Math.round((effectiveTotalKwp / inverterPowerKw) * 100),

    batteryCapacityKwh: reco.batteryCapacityKwh,
    batteryBrand: BATTERY_BRAND,

    heatPumpModel: reco.heatPumpNominalPowerKw ? HEATPUMP_MODEL : null,
    heatPumpNominalPowerKw: reco.heatPumpNominalPowerKw,

    wallboxChargeSpeedKw: profile.hasEv ? 11 : null,

    totalPriceEur: fin.totalPriceEur,
    paybackYears: fin.paybackYears,
    co2SavedTonsPer25y: fin.co2SavedTonsPer25y,
    selfConsumptionRatio: fin.selfConsumptionRatio,

    similarProjects: reco.similarProjects,
    deltaVsMedian: reco.deltaVsMedian,

    source: reco.source,
    inferenceMs: Math.round(performance.now() - t0),

    // For live-baked addresses (= addresses we just fetched + analysed
    // on demand), ship the geometry inline so the client can drive
    // HouseGeometryProvider without a second fetch on a freshly created
    // file. Demo houses load via /baked/{id}-analysis.json directly.
    geometry: resolvedHouseId.startsWith('live-') ? roof : undefined,
    matchedFromCoords:
      matchedDistanceM !== null && typeof lat === 'number' && typeof lng === 'number'
        ? { lat, lng, distanceM: matchedDistanceM }
        : undefined,
  };

  return NextResponse.json(result);
}
