// Extract ALL valid customer profiles + Reonic decisions from the dataset for Pioneer multi-task fine-tune.
// Output: data/pioneer-seeds-enriched.jsonl — one profile per line, with extraction labels AND decision labels.
//
// Each line contains:
//   - Profile fields (entities to extract) — what the customer LOOKS LIKE
//   - Decision fields (classifications to predict) — what Reonic actually SOLD to that customer
//
// Workflow:
//   pnpm tsx src/scripts/extract-pioneer-seeds.ts
//   → upload data/pioneer-seeds-enriched.jsonl to Pioneer chat
//   → Pioneer trains GLiNER2 multi-task: extraction + Reonic-trained decisions in 1 forward pass

import fs from 'node:fs';
import path from 'node:path';
import { _internals } from '../lib/sizing';

const HEATING_NAMES = ['oil', 'gas', 'heatpump', 'other'] as const;

interface SeedProfile {
  // EXTRACTION LABELS — what the customer LOOKS LIKE (from status_quo CSV)
  inhabitants_count: number;
  house_size_sqm: number;
  annual_consumption_kwh: number;
  ev_annual_km: number | null;
  has_ev: 'yes' | 'no';
  heating_type: 'oil' | 'gas' | 'heatpump' | 'other';

  // DECISION LABELS — what Reonic ACTUALLY SOLD to this customer (from project_options BOM)
  // Multi-class (4 classes each) so the classifier has real complexity to learn,
  // not a trivially-imbalanced binary task.
  battery_size_class: 'none' | 'small' | 'medium' | 'large';   // 0 / <7kWh / 7-12 / >12
  system_size_bracket: 'small' | 'medium' | 'large' | 'xlarge'; // <5 / 5-10 / 10-15 / >15 kWp
  recommend_wallbox: 'yes' | 'no';                              // 25/75 split — meaningful binary
}

function bucketBattery(kwh: number): SeedProfile['battery_size_class'] {
  if (kwh <= 0) return 'none';
  if (kwh < 7) return 'small';
  if (kwh <= 12) return 'medium';
  return 'large';
}

function bucketSystem(kwp: number): SeedProfile['system_size_bracket'] {
  if (kwp < 5) return 'small';
  if (kwp < 10) return 'medium';
  if (kwp < 15) return 'large';
  return 'xlarge';
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function main() {
  const { loadProjects } = _internals();
  const projects = loadProjects();
  console.log(`Total projects in dataset: ${projects.length}`);

  // Residential sanity filters — drop clear outliers
  const valid = projects.filter(
    (p) =>
      p.totalKwp >= 3 && p.totalKwp <= 30 &&
      p.houseSizeSqm >= 50 && p.houseSizeSqm <= 400 &&
      p.energyDemandKwh >= 1500 && p.energyDemandKwh <= 20000 &&
      p.inhabitants >= 1 && p.inhabitants <= 8,
  );
  console.log(`Valid residential profiles: ${valid.length}`);

  const seeds: SeedProfile[] = shuffle(valid).map((p) => ({
    // Extraction labels (what customer looks like)
    inhabitants_count: p.inhabitants,
    house_size_sqm: Math.round(p.houseSizeSqm),
    annual_consumption_kwh: Math.round(p.energyDemandKwh),
    ev_annual_km: p.hasEv ? Math.round(p.evKm) || 12000 : null,
    has_ev: p.hasEv ? 'yes' : 'no',
    heating_type: HEATING_NAMES[p.heatingType] ?? 'other',

    // Decision labels (what Reonic actually sold)
    battery_size_class: bucketBattery(p.batteryKwh),
    system_size_bracket: bucketSystem(p.totalKwp),
    recommend_wallbox: p.hasWallbox ? 'yes' : 'no',
  }));

  // Distribution stats for sanity
  const heatingDist = seeds.reduce<Record<string, number>>((a, s) => {
    a[s.heating_type] = (a[s.heating_type] ?? 0) + 1;
    return a;
  }, {});
  const evCount = seeds.filter((s) => s.has_ev === 'yes').length;
  const sizes = seeds.map((s) => s.house_size_sqm).sort((a, b) => a - b);
  const consumptions = seeds.map((s) => s.annual_consumption_kwh).sort((a, b) => a - b);
  const inhabitants = seeds.map((s) => s.inhabitants_count).sort((a, b) => a - b);

  // Decision label distributions
  const countBy = <K extends string>(key: (s: SeedProfile) => K) =>
    seeds.reduce<Record<string, number>>((a, s) => {
      const k = key(s);
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});
  const battDist = countBy((s) => s.battery_size_class);
  const sysDist = countBy((s) => s.system_size_bracket);
  const wbYes = seeds.filter((s) => s.recommend_wallbox === 'yes').length;

  console.log(`\nSeed distribution:`);
  console.log(`  Total seeds: ${seeds.length}`);
  console.log(`  Heating:`, heatingDist);
  console.log(`  EV: ${evCount}/${seeds.length} (${Math.round(evCount / seeds.length * 100)}%)`);
  console.log(`  House size: min=${sizes[0]} median=${sizes[Math.floor(sizes.length / 2)]} max=${sizes[sizes.length - 1]} m²`);
  console.log(`  Consumption: min=${consumptions[0]} median=${consumptions[Math.floor(consumptions.length / 2)]} max=${consumptions[consumptions.length - 1]} kWh/yr`);
  console.log(`  Inhabitants: min=${inhabitants[0]} median=${inhabitants[Math.floor(inhabitants.length / 2)]} max=${inhabitants[inhabitants.length - 1]}`);
  console.log(`\nReonic decisions (multi-class ground truth for the classifier):`);
  const pct = (n: number) => `${Math.round((n / seeds.length) * 100)}%`;
  console.log(`  battery_size_class:`, Object.fromEntries(Object.entries(battDist).map(([k, v]) => [k, `${v} (${pct(v)})`])));
  console.log(`  system_size_bracket:`, Object.fromEntries(Object.entries(sysDist).map(([k, v]) => [k, `${v} (${pct(v)})`])));
  console.log(`  recommend_wallbox:    yes ${wbYes}/${seeds.length} (${pct(wbYes)})`);

  const outPath = path.join(process.cwd(), 'data', 'pioneer-seeds-enriched.jsonl');
  const lines = seeds.map((s) => JSON.stringify(s)).join('\n') + '\n';
  fs.writeFileSync(outPath, lines, 'utf-8');
  console.log(`\n✓ Wrote ${seeds.length} seeds to ${outPath}`);
  console.log(`  File size: ${Math.round(fs.statSync(outPath).size / 1024)} KB`);
}

main();
