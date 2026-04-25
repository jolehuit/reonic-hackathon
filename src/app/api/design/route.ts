// POST /api/design — OWNED by Dev B
// Assembles a complete DesignResult for the demo:
// - For demo houses (brandenburg/hamburg/ruhr): reads pre-baked roof geometry
//   from public/baked/{houseId}-analysis.json (Dev D's analyze-roof.ts output).
// - For custom addresses (`houseId === 'custom'`): synthesises a plausible
//   roof geometry from lat/lng + houseSizeSqm so the demo works on any address
//   the jury types in. The brief explicitly authorises "estimate the space
//   available" as a fallback when on-the-fly photogrammetry is too slow.
// - Applies isJumelee divisor (semi-detached roof is shared with neighbour).
// - Calls k-NN sizing on 1620 Reonic projects.
// - Computes financials (price, payback, CO2).
// - Returns the full BOM the UI / 3D scene consumes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

import { recommendSystem } from '@/lib/sizing';
import { computeFinancials } from '@/lib/financials';
import { synthesiseRoofGeometry, inferProfileFromLocation } from '@/lib/customRoof';
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
const PANEL_EFFICIENCY = 0.18;

interface DesignRequestBody {
  houseId: HouseId | 'custom';
  profile?: CustomerProfile;
  lat?: number;
  lng?: number;
  address?: string;
}

function isSouthish(azimuthDeg: number): boolean {
  return azimuthDeg > 90 && azimuthDeg < 270;
}

async function loadBakedGeometry(houseId: HouseId): Promise<RoofGeometry> {
  const filePath = path.join(process.cwd(), 'public', 'baked', `${houseId}-analysis.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as RoofGeometry;
}

export async function POST(req: NextRequest) {
  const t0 = performance.now();

  let body: DesignRequestBody;
  try {
    body = (await req.json()) as DesignRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { houseId } = body;
  if (!houseId) {
    return NextResponse.json({ error: 'Missing houseId' }, { status: 400 });
  }

  // 1. Resolve profile (provided, or inferred for custom)
  let profile: CustomerProfile | undefined = body.profile;
  if (!profile && houseId === 'custom') {
    profile = inferProfileFromLocation(body.lat, body.lng);
  }
  if (!profile) {
    return NextResponse.json({ error: 'Missing profile' }, { status: 400 });
  }

  // 2. Resolve roof geometry
  let roof: RoofGeometry;
  let synthesised = false;
  if (houseId === 'custom') {
    roof = synthesiseRoofGeometry(body.lat ?? 0, body.lng ?? 0, profile.houseSizeSqm);
    synthesised = true;
  } else {
    try {
      roof = await loadBakedGeometry(houseId);
    } catch {
      return NextResponse.json(
        { error: `No analysis.json for house "${houseId}"` },
        { status: 404 },
      );
    }
  }

  // 3. Compute the maximum solar capacity the roof can host (south-ish faces only).
  //    isJumelee → divide by 2 (shared roof with neighbour).
  const houseShareDivisor = profile.isJumelee ? 2 : 1;
  const southFaces = roof.faces.filter((f) => isSouthish(f.azimuth));
  const rawRoofMaxKwp =
    southFaces.reduce((sum, f) => sum + f.usableArea * PANEL_EFFICIENCY, 0)
    || roof.faces.reduce((sum, f) => sum + f.usableArea * PANEL_EFFICIENCY, 0);
  const roofMaxKwp = rawRoofMaxKwp / houseShareDivisor;

  // 4. k-NN sizing on the 1620 Reonic projects
  const reco = await recommendSystem(profile, roofMaxKwp);

  // 5. Module count + inverter sizing
  const moduleCount = Math.max(1, Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK));
  const inverterPowerKw = Math.max(1, Math.ceil(reco.totalKwp * 0.85));

  // 6. Financials
  const fin = computeFinancials({
    totalKwp: reco.totalKwp,
    batteryKwh: reco.batteryCapacityKwh,
    heatPumpKw: reco.heatPumpNominalPowerKw,
    hasWallbox: profile.hasEv,
    annualConsumptionKwh: profile.annualConsumptionKwh,
    hasEv: profile.hasEv,
  });

  // 7. Trim modulePositions if k-NN sized us below the roof maximum.
  const baseModulePositions = roof.modulePositions ?? [];
  const targetCount = Math.min(moduleCount, baseModulePositions.length);
  const modulePositions = targetCount > 0
    ? baseModulePositions.slice(0, targetCount)
    : baseModulePositions;

  const result: DesignResult = {
    moduleCount: modulePositions.length || moduleCount,
    moduleBrand: MODULE_BRAND,
    moduleWattPeak: MODULE_WATT_PEAK,
    totalKwp: reco.totalKwp,
    modulePositions,

    inverterModel: INVERTER_MODEL,
    inverterPowerKw,
    inverterLoadPercent: Math.round((reco.totalKwp / inverterPowerKw) * 100),

    batteryCapacityKwh: reco.batteryCapacityKwh,
    batteryBrand: BATTERY_BRAND,

    heatPumpModel: reco.heatPumpNominalPowerKw ? HEATPUMP_MODEL : null,
    heatPumpNominalPowerKw: reco.heatPumpNominalPowerKw,

    wallboxChargeSpeedKw: profile.hasEv ? 11 : null,

    totalPriceEur: fin.totalPriceEur,
    paybackYears: fin.paybackYears,
    co2SavedTonsPer25y: fin.co2SavedTonsPer25y,

    similarProjects: reco.similarProjects,
    deltaVsMedian: reco.deltaVsMedian,

    source: reco.source,
    inferenceMs: Math.round(performance.now() - t0),

    geometry: synthesised ? roof : undefined,
  };

  return NextResponse.json(result);
}
