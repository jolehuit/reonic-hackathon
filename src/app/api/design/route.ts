// POST /api/design — OWNED by Dev B
// Assembles a complete DesignResult for the demo:
// - reads pre-baked roof geometry (from Dev D's analyze-roof.ts output)
// - calls k-NN sizing on 1620 Reonic projects
// - computes financials (price, payback, CO2)
// - returns the full BOM the UI / 3D scene can consume.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

import { recommendSystem } from '@/lib/sizing';
import { computeFinancials } from '@/lib/financials';
import type {
  CustomerProfile,
  DesignResult,
  HouseId,
  RoofGeometry,
} from '@/lib/types';

// 2026 reference modules / inverters used in the BOM display
const MODULE_WATT_PEAK = 475;            // AIKO 475Wp standard
const MODULE_BRAND: 'AIKO' | 'Trina' = 'AIKO';
const INVERTER_MODEL = 'SMA Tripower X';
const BATTERY_BRAND = 'BYD HVS';
const HEATPUMP_MODEL = 'Viessmann Vitocal 250-A';
const PANEL_EFFICIENCY = 0.18;           // kWp per m² of roof area, well-aligned

function isSouthish(azimuthDeg: number): boolean {
  // accept everything from East (90°) to West (270°), passing through South (180°)
  return azimuthDeg > 90 && azimuthDeg < 270;
}

async function loadRoofGeometry(houseId: HouseId): Promise<RoofGeometry> {
  const filePath = path.join(process.cwd(), 'public', 'baked', `${houseId}-analysis.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as RoofGeometry;
}

export async function POST(req: NextRequest) {
  const t0 = performance.now();

  let body: { profile: CustomerProfile; houseId: HouseId };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { profile, houseId } = body;
  if (!profile || !houseId) {
    return NextResponse.json({ error: 'Missing profile or houseId' }, { status: 400 });
  }

  // 1. Load roof geometry baked by Dev D
  let roof: RoofGeometry;
  try {
    roof = await loadRoofGeometry(houseId);
  } catch {
    return NextResponse.json(
      { error: `No analysis.json for house "${houseId}"` },
      { status: 404 },
    );
  }

  // 2. Compute the maximum solar capacity the roof can host (south-ish faces only)
  const southFaces = roof.faces.filter((f) => isSouthish(f.azimuth));
  const roofMaxKwp = southFaces.reduce((sum, f) => sum + f.area * PANEL_EFFICIENCY, 0)
    || roof.faces.reduce((sum, f) => sum + f.area * PANEL_EFFICIENCY, 0); // fallback if no south face

  // 3. k-NN sizing on the 1620 Reonic projects
  const reco = await recommendSystem(profile, roofMaxKwp);

  // 4. Module count + inverter sizing
  const moduleCount = Math.max(1, Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK));
  const inverterPowerKw = Math.max(1, Math.ceil(reco.totalKwp * 0.85));

  // 5. Financials
  const fin = computeFinancials({
    totalKwp: reco.totalKwp,
    batteryKwh: reco.batteryCapacityKwh,
    heatPumpKw: reco.heatPumpNominalPowerKw,
    hasWallbox: profile.hasEv,                  // wallbox iff customer has an EV
    annualConsumptionKwh: profile.annualConsumptionKwh,
    hasEv: profile.hasEv,
  });

  // 6. Assemble the full DesignResult the UI / 3D scene consume
  const result: DesignResult = {
    moduleCount,
    moduleBrand: MODULE_BRAND,
    moduleWattPeak: MODULE_WATT_PEAK,
    totalKwp: reco.totalKwp,
    modulePositions: roof.modulePositions ?? [],

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
  };

  return NextResponse.json(result);
}
