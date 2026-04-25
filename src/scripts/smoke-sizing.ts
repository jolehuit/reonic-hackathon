// Smoke test : run via `pnpm tsx src/scripts/smoke-sizing.ts`
// Verifies sizing.ts parses CSVs correctly and returns sensible recommendations.

import { recommendSystem, findSimilarProjects, _internals } from '../lib/sizing';
import type { CustomerProfile } from '../lib/types';

async function main() {
  const t0 = performance.now();
  const { loadProjects } = _internals();
  const all = loadProjects();
  console.log(`✓ Loaded ${all.length} projects in ${Math.round(performance.now() - t0)}ms`);

  // Sanity stats
  const kwps = all.map((p) => p.totalKwp).sort((a, b) => a - b);
  const batts = all.map((p) => p.batteryKwh);
  console.log(`  kWp: min=${kwps[0].toFixed(1)} median=${kwps[Math.floor(kwps.length / 2)].toFixed(1)} max=${kwps[kwps.length - 1].toFixed(1)}`);
  console.log(`  Battery: ${batts.filter((b) => b > 0).length}/${all.length} projects with battery`);
  console.log(`  HeatPump: ${all.filter((p) => p.hasHeatPump).length}/${all.length} projects with HP`);
  console.log(`  EV: ${all.filter((p) => p.hasEv).length}/${all.length} projects with EV`);

  const testProfiles: { name: string; profile: CustomerProfile }[] = [
    {
      name: 'Brandenburg family — typical',
      profile: {
        annualConsumptionKwh: 4500,
        inhabitants: 4,
        hasEv: true,
        evAnnualKm: 12000,
        heatingType: 'gas',
        houseSizeSqm: 140,
      },
    },
    {
      name: 'Hamburg single — small',
      profile: {
        annualConsumptionKwh: 2800,
        inhabitants: 1,
        hasEv: false,
        heatingType: 'oil',
        houseSizeSqm: 75,
      },
    },
    {
      name: 'Ruhr family — heatpump + EV',
      profile: {
        annualConsumptionKwh: 7200,
        inhabitants: 5,
        hasEv: true,
        evAnnualKm: 18000,
        heatingType: 'heatpump',
        houseSizeSqm: 180,
      },
    },
  ];

  for (const { name, profile } of testProfiles) {
    console.log(`\n--- ${name} ---`);
    const ts = performance.now();
    const reco = await recommendSystem(profile, 15);
    const ms = Math.round(performance.now() - ts);
    console.log(`  ${ms}ms  →  ${reco.totalKwp} kWp · ${reco.batteryCapacityKwh ?? 'no'} kWh batt · HP ${reco.heatPumpNominalPowerKw ?? 'no'}`);
    console.log(`  Top-5 similar:`);
    reco.similarProjects.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.projectId.slice(0, 8)}  ${p.energyDemandKwh.toFixed(0)} kWh/yr  ${p.totalKwp.toFixed(1)} kWp  ${p.batteryKwh.toFixed(1)} kWh  EV=${p.hasEv}`);
    });
  }

  console.log(`\nTotal smoke time: ${Math.round(performance.now() - t0)}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
