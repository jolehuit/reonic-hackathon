// Backtest LOOCV (Leave-One-Out Cross-Validation) for the k-NN sizing engine.
// Run: pnpm tsx src/scripts/backtest.ts
//
// For each of the N valid projects, hold it out, train k-NN on the other N-1,
// predict kWp / battery, compute error vs actual install. Output: accuracy stats
// + a CSV of (actual, predicted) pairs that can be charted in the pitch.

import fs from 'node:fs';
import path from 'node:path';
import { _internals } from '../lib/sizing';

const HEATING_NAMES = ['oil', 'gas', 'heatpump', 'other'] as const;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

function main() {
  const t0 = performance.now();
  const { loadProjects, kNearest } = _internals();
  const all = loadProjects();
  const valid = all.filter(
    (p) =>
      p.totalKwp >= 3 && p.totalKwp <= 30 &&
      p.energyDemandKwh >= 1500 && p.energyDemandKwh <= 20000,
  );
  console.log(`LOOCV over ${valid.length} valid projects (k=10 internal, median aggregator)`);

  const records: { actualKwp: number; predKwp: number; actualBatt: number; predBatt: number }[] = [];

  for (const target of valid) {
    const pool = valid.filter((p) => p.projectId !== target.projectId);

    const targetProfile = {
      annualConsumptionKwh: target.energyDemandKwh,
      inhabitants: target.inhabitants,
      hasEv: !!target.hasEv,
      evAnnualKm: target.evKm,
      heatingType: HEATING_NAMES[target.heatingType] ?? 'other',
      houseSizeSqm: target.houseSizeSqm,
      isJumelee: false,
    };

    const top10 = kNearest(targetProfile, 10, pool);
    const predKwp = median(top10.map((p) => p.totalKwp));
    const battNeighbors = top10.filter((p) => p.batteryKwh > 0);
    const predBatt = battNeighbors.length >= 5 ? median(battNeighbors.map((p) => p.batteryKwh)) : 0;

    records.push({
      actualKwp: target.totalKwp,
      predKwp,
      actualBatt: target.batteryKwh,
      predBatt,
    });
  }

  // Compute metrics
  const errs = records.map((r) => Math.abs(r.predKwp - r.actualKwp) / r.actualKwp);
  const battErrsKwh = records
    .filter((r) => r.actualBatt > 0)
    .map((r) => Math.abs(r.predBatt - r.actualBatt));

  const mape = errs.reduce((s, e) => s + e, 0) / errs.length;
  const mae = records.reduce((s, r) => s + Math.abs(r.predKwp - r.actualKwp), 0) / records.length;
  const rmse = Math.sqrt(records.reduce((s, r) => s + (r.predKwp - r.actualKwp) ** 2, 0) / records.length);
  const acc10 = errs.filter((e) => e <= 0.10).length / errs.length;
  const acc20 = errs.filter((e) => e <= 0.20).length / errs.length;
  const acc30 = errs.filter((e) => e <= 0.30).length / errs.length;
  const battMae = battErrsKwh.length > 0 ? battErrsKwh.reduce((s, e) => s + e, 0) / battErrsKwh.length : 0;

  console.log(`\n=== kWp prediction (${records.length} samples) ===`);
  console.log(`  MAPE:           ${(mape * 100).toFixed(1)}%`);
  console.log(`  MAE:            ${mae.toFixed(2)} kWp`);
  console.log(`  RMSE:           ${rmse.toFixed(2)} kWp`);
  console.log(`  Accuracy@10%:   ${(acc10 * 100).toFixed(1)}%   (predictions within ±10% of actual)`);
  console.log(`  Accuracy@20%:   ${(acc20 * 100).toFixed(1)}%`);
  console.log(`  Accuracy@30%:   ${(acc30 * 100).toFixed(1)}%`);
  console.log(`\n=== Battery prediction (${battErrsKwh.length} samples with real battery) ===`);
  console.log(`  MAE:            ${battMae.toFixed(2)} kWh`);

  const outDir = path.join(process.cwd(), 'data');
  const csvPath = path.join(outDir, 'backtest-results.csv');
  const csv = ['actual_kwp,pred_kwp,actual_batt_kwh,pred_batt_kwh']
    .concat(records.map((r) => `${r.actualKwp.toFixed(2)},${r.predKwp.toFixed(2)},${r.actualBatt.toFixed(2)},${r.predBatt.toFixed(2)}`))
    .join('\n');
  fs.writeFileSync(csvPath, csv, 'utf-8');

  const summaryPath = path.join(outDir, 'backtest-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    samples: records.length,
    mape, mae, rmse,
    accuracy_at_10pct: acc10,
    accuracy_at_20pct: acc20,
    accuracy_at_30pct: acc30,
    battery_mae_kwh: battMae,
    elapsed_ms: Math.round(performance.now() - t0),
  }, null, 2));

  console.log(`\n✓ Wrote ${csvPath}`);
  console.log(`✓ Wrote ${summaryPath}`);
  console.log(`\nElapsed: ${Math.round(performance.now() - t0)}ms`);
}

main();
