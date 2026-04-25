// k-NN sizing engine — OWNED by Dev B
// In-memory over the Reonic dataset (1620 status_quo rows × ~20 BOM line items each).
// Primary source of truth for kWp / kWh / heatpump / similar-projects in /api/design.
//
// Data convention (Reonic CSVs):
// - All energy columns are stored in Wh (e.g. energy_demand_wh = 4_500_000 → 4500 kWh)
// - All "_kwh" / "_kw" columns are ALSO stored in Wh / W (e.g. battery_capacity_kwh = 12_000 → 12 kWh)
// - module_watt_peak is in W per panel (e.g. 475 → 475 Wp)
// We normalize everything to kWh / kW internally.

import fs from 'node:fs';
import path from 'node:path';
import type { CustomerProfile, DesignResult, SimilarProject } from './types';

export interface ProjectRow {
  projectId: string;
  // Inputs (from status_quo)
  energyDemandKwh: number;
  hasEv: number;          // 0/1
  evKm: number;
  heatingType: number;    // 0=oil, 1=gas, 2=heatpump, 3=other
  houseSizeSqm: number;
  inhabitants: number;
  // Outputs (aggregated from options_parts, option_number=1)
  totalKwp: number;
  batteryKwh: number;
  hasHeatPump: number;
  heatPumpKw: number;
  hasWallbox: number;
}

const HEATING_MAP: Record<string, number> = {
  Oil: 0,
  oil: 0,
  Gas: 1,
  gas: 1,
  Heatpump: 2,
  heatpump: 2,
  OtherNonRenewable: 3,
  other: 3,
};

let PROJECTS: ProjectRow[] | null = null;
let MEAN: number[] = [];
let STD: number[] = [];

// --- CSV parser (tolerant, no quoted commas in this dataset) ---
function parseCsv(content: string): Record<string, string>[] {
  const lines = content.replace(/\r/g, '').trim().split('\n');
  if (lines.length === 0) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const fields = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = fields[i] ?? '';
    return row;
  });
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

function loadProjects(): ProjectRow[] {
  if (PROJECTS) return PROJECTS;

  const dataDir = path.join(process.cwd(), 'data');
  const statusQuo = [
    parseCsv(fs.readFileSync(path.join(dataDir, 'projects_status_quo_1.csv'), 'utf-8')),
    parseCsv(fs.readFileSync(path.join(dataDir, 'projects_status_quo_2.csv'), 'utf-8')),
  ].flat();

  const options = [
    parseCsv(fs.readFileSync(path.join(dataDir, 'project_options_parts_1.csv'), 'utf-8')),
    parseCsv(fs.readFileSync(path.join(dataDir, 'project_options_parts_2.csv'), 'utf-8')),
  ].flat();

  // The Reonic dataset stores BOM info in messy ways across multiple line items.
  // Strategy: for each (project, option_number=1), aggregate signals from many sources.
  //
  // - kWp: max(qty) of ModuleFrameConstruction rows × 475W default panel (covers 721 projects)
  //        OR from "Hybrid Inverter XkW" / "PV Complete Package XkW" / "X.XkWp + YkWh" patterns
  // - Battery kWh: parse component_name regex on BatteryStorage rows
  // - Wallbox: any Wallbox component_type row OR wb_charging_speed_kw populated
  // - HeatPump: any Heatpump component_type row OR heatpump_nominal_power_kw populated

  const KWP_FROM_NAME = /(\d+(?:\.\d+)?)\s*kWp/i;
  const KW_FROM_NAME = /(\d+(?:\.\d+)?)\s*kW(?![hp])/i; // kW but not kWh / kWp
  const KWH_FROM_NAME = /(\d+(?:\.\d+)?)\s*kWh/i;
  const DEFAULT_PANEL_W = 475;

  const bomByProject = new Map<string, {
    panelCount: number;        // max qty across ModuleFrameConstruction rows
    explicitKwp: number;       // from package / inverter strings
    batteryKwh: number;
    hasHeatPump: number;
    heatPumpKw: number;
    hasWallbox: number;
  }>();

  for (const row of options) {
    if (parseInt(row.option_number || '1', 10) !== 1) continue;
    const pid = row.project_id;
    const cur = bomByProject.get(pid) ?? {
      panelCount: 0, explicitKwp: 0, batteryKwh: 0,
      hasHeatPump: 0, heatPumpKw: 0, hasWallbox: 0,
    };

    const ctype = row.component_type;
    const cname = row.component_name || '';

    // --- kWp signals ---
    if (ctype === 'ModuleFrameConstruction') {
      const qty = num(row.quantity);
      if (qty > 0) cur.panelCount = Math.max(cur.panelCount, qty);
      // Also try "Substructure 8.8-15kWp" → take upper bound midpoint
      const m = cname.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*kWp/i);
      if (m) cur.explicitKwp = Math.max(cur.explicitKwp, (parseFloat(m[1]) + parseFloat(m[2])) / 2);
    }
    if (ctype === 'Inverter') {
      const m = cname.match(KW_FROM_NAME);
      if (m) cur.explicitKwp = Math.max(cur.explicitKwp, parseFloat(m[1]));
    }
    if (ctype === 'ServiceFee' && /PV Complete Package/i.test(cname)) {
      const m = cname.match(KW_FROM_NAME);
      if (m) cur.explicitKwp = Math.max(cur.explicitKwp, parseFloat(m[1]));
    }
    if (ctype === 'Other' && /Complete Package/i.test(cname)) {
      // e.g. "Complete Package 2 Sigenergy 10.8kWp + 9kWh"
      const k = cname.match(KWP_FROM_NAME);
      if (k) cur.explicitKwp = Math.max(cur.explicitKwp, parseFloat(k[1]));
      const b = cname.match(KWH_FROM_NAME);
      if (b) cur.batteryKwh = Math.max(cur.batteryKwh, parseFloat(b[1]));
    }
    // Module-typed rows have module_watt_peak set (rare, ~71 rows)
    const moduleWatt = num(row.module_watt_peak);
    const qty = num(row.quantity);
    if (moduleWatt > 0 && qty > 0) {
      cur.explicitKwp = Math.max(cur.explicitKwp, (moduleWatt * qty) / 1000);
    }

    // --- Battery ---
    if (ctype === 'BatteryStorage') {
      const m = cname.match(KWH_FROM_NAME);
      if (m) cur.batteryKwh = Math.max(cur.batteryKwh, parseFloat(m[1]));
      const colKwh = num(row.battery_capacity_kwh);
      if (colKwh > 0) cur.batteryKwh = Math.max(cur.batteryKwh, colKwh / 1000);
    }

    // --- Wallbox ---
    if (ctype === 'Wallbox') cur.hasWallbox = 1;
    if (num(row.wb_charging_speed_kw) > 0) cur.hasWallbox = 1;

    // --- Heat pump ---
    if (ctype === 'Heatpump') {
      cur.hasHeatPump = 1;
      const m = cname.match(KW_FROM_NAME);
      if (m) cur.heatPumpKw = Math.max(cur.heatPumpKw, parseFloat(m[1]));
    }
    const hpCol = num(row.heatpump_nominal_power_kw);
    if (hpCol > 0) {
      cur.hasHeatPump = 1;
      cur.heatPumpKw = Math.max(cur.heatPumpKw, hpCol / 1000);
    }

    bomByProject.set(pid, cur);
  }

  // Join with status_quo.
  //
  // The Reonic dataset is sparse on GDPR-sensitive fields: only 200/1620 rows have
  // heating_existing_type populated, only 8/1620 have house_size_sqm. When missing,
  // we synthesize plausible values from energy consumption and the BOM signals:
  // - house_size_sqm ≈ energyKwh / 35 (typical German residential 30-40 kWh/m²/yr),
  //   clamped to 60-300 m²
  // - heating_type: priority (a) if BOM offered HP → 'heatpump' (Reonic upsells HP);
  //   (b) if real value present, use it; (c) else market-weighted random
  //   (gas 55%, oil 25%, other 15%, heatpump 5%)
  // This is disclosed in the pitch: "synthesized when the dataset stripped the field for GDPR".

  // Market-realistic distributions for fields that are mostly empty in the dataset.
  const HEATING_WEIGHTS: [number, number][] = [
    [0, 0.25], // oil 25%
    [1, 0.55], // gas 55%
    [2, 0.05], // heatpump 5%
    [3, 0.15], // other 15%
  ];
  // German residential household size distribution (Destatis 2024 approx)
  const INHABITANT_WEIGHTS: [number, number][] = [
    [1, 0.12], [2, 0.30], [3, 0.25], [4, 0.23], [5, 0.08], [6, 0.02],
  ];

  function seededRand(seed: number): number {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  function pickWeighted<T extends number>(weights: [T, number][], r: number): T {
    let acc = 0;
    for (const [v, w] of weights) {
      acc += w;
      if (r <= acc) return v;
    }
    return weights[weights.length - 1][0];
  }

  const projects: ProjectRow[] = [];
  let synthIdx = 0;
  for (const sq of statusQuo) {
    const pid = sq.project_id;
    const bom = bomByProject.get(pid);
    if (!bom) continue;

    const fromPanels = bom.panelCount * DEFAULT_PANEL_W / 1000;
    const totalKwp = Math.max(fromPanels, bom.explicitKwp);
    if (totalKwp <= 0) continue;

    const energyKwh = num(sq.energy_demand_wh) / 1000;
    if (energyKwh <= 0) continue;

    // Inhabitants: real value if any, else weighted-random from German residential distribution
    const realInhab = num(sq.num_inhabitants);
    const inhabitants = realInhab > 0
      ? realInhab
      : pickWeighted(INHABITANT_WEIGHTS, seededRand(synthIdx * 17 + 3));

    // House size: real value if any, else synthesize from consumption + inhabitants
    const realSize = num(sq.house_size_sqm);
    const sizeJitter = (seededRand(synthIdx * 31 + 7) - 0.5) * 30; // ±15 m² noise
    const houseSizeSqm = realSize > 0
      ? realSize
      : Math.round(Math.max(60, Math.min(320, 30 + inhabitants * 18 + energyKwh / 50 + sizeJitter)));

    // Heating type
    let heatingType: number;
    if (bom.hasHeatPump) {
      heatingType = 2; // heatpump
    } else if (sq.heating_existing_type && HEATING_MAP[sq.heating_existing_type] !== undefined) {
      heatingType = HEATING_MAP[sq.heating_existing_type];
    } else {
      heatingType = pickWeighted(HEATING_WEIGHTS, seededRand(synthIdx * 53 + 11));
    }
    synthIdx++;

    projects.push({
      projectId: pid,
      energyDemandKwh: energyKwh,
      hasEv: sq.has_ev === 'True' ? 1 : 0,
      evKm: num(sq.ev_annual_drive_distance_km),
      heatingType,
      houseSizeSqm,
      inhabitants,
      totalKwp,
      batteryKwh: bom.batteryKwh,
      hasHeatPump: bom.hasHeatPump,
      heatPumpKw: bom.heatPumpKw,
      hasWallbox: bom.hasWallbox,
    });
  }

  // Compute mean/std for the 4 numeric features (z-score normalization)
  const numericKeys = ['energyDemandKwh', 'evKm', 'houseSizeSqm', 'inhabitants'] as const;
  MEAN = numericKeys.map((k) => projects.reduce((s, p) => s + p[k], 0) / projects.length);
  STD = numericKeys.map((k, i) => {
    const variance = projects.reduce((s, p) => s + (p[k] - MEAN[i]) ** 2, 0) / projects.length;
    return Math.sqrt(variance) || 1;
  });

  PROJECTS = projects;
  console.log(`[sizing] Loaded ${projects.length} projects (out of ${statusQuo.length} status-quo rows)`);
  return PROJECTS;
}

// --- Distance + normalization ---
function normalizeRow(row: ProjectRow): number[] {
  return [
    (row.energyDemandKwh - MEAN[0]) / STD[0],
    (row.evKm - MEAN[1]) / STD[1],
    (row.houseSizeSqm - MEAN[2]) / STD[2],
    (row.inhabitants - MEAN[3]) / STD[3],
    row.hasEv,
    row.heatingType / 3,
  ];
}

function normalizeProfile(p: CustomerProfile): number[] {
  const heating = HEATING_MAP[p.heatingType] ?? 3;
  return [
    (p.annualConsumptionKwh - MEAN[0]) / STD[0],
    ((p.evAnnualKm ?? 0) - MEAN[1]) / STD[1],
    (p.houseSizeSqm - MEAN[2]) / STD[2],
    (p.inhabitants - MEAN[3]) / STD[3],
    p.hasEv ? 1 : 0,
    heating / 3,
  ];
}

function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

// --- Public API ---

/** Returns the k nearest project rows to a given customer profile. Used internally and for backtest. */
export function kNearest(profile: CustomerProfile, k: number, pool?: ProjectRow[]): ProjectRow[] {
  const projects = pool ?? loadProjects();
  const target = normalizeProfile(profile);
  return projects
    .map((row) => ({ row, d: distance(target, normalizeRow(row)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.row);
}

/**
 * Recommends a system based on the median of the 10 most similar Reonic projects.
 * Returns the subset of DesignResult fields owned by the sizing engine.
 */
export async function recommendSystem(
  profile: CustomerProfile,
  roofMaxKwp: number,
): Promise<Pick<DesignResult, 'totalKwp' | 'batteryCapacityKwh' | 'heatPumpNominalPowerKw' | 'similarProjects' | 'deltaVsMedian' | 'source' | 'inferenceMs'>> {
  const start = performance.now();
  const top10 = kNearest(profile, 10);
  const top5 = top10.slice(0, 5);

  const totalKwp = Math.min(median(top10.map((p) => p.totalKwp)), roofMaxKwp);

  // Battery only recommended if at least half the top-10 had one
  const battNeighbors = top10.filter((p) => p.batteryKwh > 0);
  const batteryCapacityKwh = battNeighbors.length >= 5
    ? Math.round(median(battNeighbors.map((p) => p.batteryKwh)) * 10) / 10
    : null;

  // Heat pump only if half the top-10 had one
  const hpNeighbors = top10.filter((p) => p.hasHeatPump);
  const heatPumpNominalPowerKw = hpNeighbors.length >= 5
    ? Math.round(median(hpNeighbors.map((p) => p.heatPumpKw)) * 10) / 10
    : null;

  const top5KwpMedian = median(top5.map((p) => p.totalKwp));
  const top5BattMedian = median(top5.map((p) => p.batteryKwh));

  return {
    totalKwp: Math.round(totalKwp * 10) / 10,
    batteryCapacityKwh,
    heatPumpNominalPowerKw,
    similarProjects: top5.map((p): SimilarProject => ({
      projectId: p.projectId,
      energyDemandKwh: p.energyDemandKwh,
      hasEv: !!p.hasEv,
      totalKwp: p.totalKwp,
      batteryKwh: p.batteryKwh,
      priceEur: 0, // computed in /api/design via financials.ts
    })),
    deltaVsMedian: {
      kwp: Math.round((totalKwp - top5KwpMedian) * 10) / 10,
      batteryKwh: Math.round(((batteryCapacityKwh ?? 0) - top5BattMedian) * 10) / 10,
      priceEur: 0,
    },
    source: 'knn' as const,
    inferenceMs: Math.round(performance.now() - start),
  };
}

/** Returns the top-k most similar projects from the Reonic dataset. */
export function findSimilarProjects(profile: CustomerProfile, k: number = 3): SimilarProject[] {
  const top = kNearest(profile, k);
  return top.map((p) => ({
    projectId: p.projectId,
    energyDemandKwh: p.energyDemandKwh,
    hasEv: !!p.hasEv,
    totalKwp: p.totalKwp,
    batteryKwh: p.batteryKwh,
    priceEur: 0,
  }));
}

/** Exposed for backtest scripts. */
export function _internals() {
  return { loadProjects, kNearest, normalizeProfile, normalizeRow, distance, median };
}
