// Generate V3 classification dataset for Pioneer multi-label fine-tune.
//
// CRITICAL DESIGN: text contains ONLY the customer profile description, NO suffix.
// The labels are CLASSIFICATION TARGETS — what Reonic actually sold to that customer.
// The model must LEARN to predict labels from the profile, not extract them from text.
//
// Run: pnpm tsx src/scripts/extract-pioneer-classification.ts
// Output: data/pioneer-classification.jsonl (Pioneer dataset_type: classification)

import fs from 'node:fs';
import path from 'node:path';
import { _internals, type ProjectRow } from '../lib/sizing';

const HEATING_NAMES = ['oil', 'gas', 'heatpump', 'other'] as const;

interface ClassificationRow {
  text: string;
  labels: string[];   // exactly 3: one bat_*, one sys_*, one wallbox_*
}

function bucketBattery(kwh: number): 'none' | 'small' | 'medium' | 'large' {
  if (kwh <= 0) return 'none';
  if (kwh < 7) return 'small';
  if (kwh <= 12) return 'medium';
  return 'large';
}
function bucketSystem(kwp: number): 'small' | 'medium' | 'large' | 'xlarge' {
  if (kwp < 5) return 'small';
  if (kwp < 10) return 'medium';
  if (kwp < 15) return 'large';
  return 'xlarge';
}

// --- NL templates ---

const HEATING_DE: Record<typeof HEATING_NAMES[number], string> = {
  oil: 'Ölheizung', gas: 'Gasheizung', heatpump: 'Wärmepumpe', other: 'andere Heizung',
};
const HEATING_EN: Record<typeof HEATING_NAMES[number], string> = {
  oil: 'oil heating', gas: 'gas heating', heatpump: 'heat pump', other: 'other heating',
};
const HEATING_FR: Record<typeof HEATING_NAMES[number], string> = {
  oil: 'fioul', gas: 'gaz', heatpump: 'pompe à chaleur', other: 'autre',
};

interface Ctx {
  inhab: number;
  size: number;
  kwh: number;
  hasEv: boolean;
  evKm: number;
  heating: typeof HEATING_NAMES[number];
}

function evDE(c: Ctx): string {
  if (!c.hasEv) return 'Kein Elektroauto.';
  return `Wir haben ein Elektroauto und fahren ca. ${c.evKm} km pro Jahr.`;
}
function evEN(c: Ctx): string {
  if (!c.hasEv) return 'No electric vehicle.';
  return `We drive an EV approximately ${c.evKm} km per year.`;
}
function evFR(c: Ctx): string {
  if (!c.hasEv) return 'Pas de voiture électrique.';
  return `Nous avons une voiture électrique, environ ${c.evKm} km par an.`;
}

const TEMPLATES_DE: Array<(c: Ctx) => string> = [
  (c) => `Familie mit ${c.inhab} Personen, Einfamilienhaus ${c.size} m², Jahresverbrauch ${c.kwh} kWh, ${HEATING_DE[c.heating]}. ${evDE(c)}`,
  (c) => `Wir sind ${c.inhab} im Haushalt, ${c.size} m² Wohnfläche, ${c.kwh} kWh/Jahr, Heizung: ${HEATING_DE[c.heating]}. ${evDE(c)}`,
  (c) => `${c.inhab} Pers., ${c.size} m², ${c.kwh} kWh/a, ${HEATING_DE[c.heating]}. ${evDE(c)}`,
  (c) => `Haushalt mit ${c.inhab} Bewohnern in einem ${c.size} m² Haus. Wir verbrauchen ca. ${c.kwh} kWh pro Jahr und heizen mit ${HEATING_DE[c.heating]}. ${evDE(c)}`,
  (c) => `${c.inhab}-köpfige Familie, Wohnfläche ${c.size} qm, Stromverbrauch ${c.kwh} kWh jährlich, ${HEATING_DE[c.heating]}. ${evDE(c)}`,
  (c) => `Wir wohnen mit ${c.inhab} Personen auf ${c.size} m². Verbrauch: ${c.kwh} kWh pro Jahr. Heizung: ${HEATING_DE[c.heating]}. ${evDE(c)}`,
];

const TEMPLATES_EN: Array<(c: Ctx) => string> = [
  (c) => `Family of ${c.inhab}, ${c.size} m² home, ${c.kwh} kWh annual consumption, ${HEATING_EN[c.heating]}. ${evEN(c)}`,
  (c) => `${c.inhab} people in a ${c.size} m² house, ${HEATING_EN[c.heating]}, ${c.kwh} kWh per year. ${evEN(c)}`,
  (c) => `Household: ${c.inhab} occupants, ${c.size} sqm, ${c.kwh} kWh per year, ${HEATING_EN[c.heating]}. ${evEN(c)}`,
  (c) => `We are ${c.inhab} living in a ${c.size} m² home. Yearly electricity ${c.kwh} kWh, ${HEATING_EN[c.heating]}. ${evEN(c)}`,
];

const TEMPLATES_FR: Array<(c: Ctx) => string> = [
  (c) => `Foyer de ${c.inhab} personnes, maison ${c.size} m², consommation ${c.kwh} kWh/an, chauffage ${HEATING_FR[c.heating]}. ${evFR(c)}`,
  (c) => `${c.inhab} habitants dans une maison de ${c.size} m², ${c.kwh} kWh annuels, ${HEATING_FR[c.heating]}. ${evFR(c)}`,
  (c) => `Nous sommes ${c.inhab}, ${c.size} m² de surface, environ ${c.kwh} kWh par an, chauffage au ${HEATING_FR[c.heating]}. ${evFR(c)}`,
];

function rand<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Deterministic seeded RNG (Mulberry32) for reproducibility
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function projectToCtx(p: ProjectRow): Ctx {
  return {
    inhab: p.inhabitants,
    size: Math.round(p.houseSizeSqm),
    kwh: Math.round(p.energyDemandKwh),
    hasEv: !!p.hasEv,
    evKm: p.evKm > 0 ? Math.round(p.evKm) : 12000,
    heating: HEATING_NAMES[p.heatingType] ?? 'other',
  };
}

function generateVariants(p: ProjectRow, n: number, rng: () => number): string[] {
  const ctx = projectToCtx(p);
  const out = new Set<string>();
  let safety = 0;
  while (out.size < n && safety < 50) {
    safety++;
    const lang = rng();
    const tpl = lang < 0.6
      ? rand(TEMPLATES_DE, rng)
      : lang < 0.9
      ? rand(TEMPLATES_EN, rng)
      : rand(TEMPLATES_FR, rng);
    out.add(tpl(ctx).trim());
  }
  return Array.from(out);
}

function main() {
  const { loadProjects } = _internals();
  const projects = loadProjects();

  const valid = projects.filter(
    (p) =>
      p.totalKwp >= 3 && p.totalKwp <= 30 &&
      p.houseSizeSqm >= 50 && p.houseSizeSqm <= 400 &&
      p.energyDemandKwh >= 1500 && p.energyDemandKwh <= 20000 &&
      p.inhabitants >= 1 && p.inhabitants <= 8,
  );
  console.log(`Valid residential profiles: ${valid.length}`);

  const VARIANTS = 6;
  const rows: ClassificationRow[] = [];
  let pidx = 0;
  for (const p of valid) {
    pidx++;
    const rng = mulberry32(pidx * 1000 + 1);
    const battLabel = `bat_${bucketBattery(p.batteryKwh)}`;
    const sysLabel = `sys_${bucketSystem(p.totalKwp)}`;
    const wbLabel = `wallbox_${p.hasWallbox ? 'yes' : 'no'}`;
    for (const text of generateVariants(p, VARIANTS, rng)) {
      rows.push({ text, labels: [battLabel, sysLabel, wbLabel] });
    }
  }

  // Shuffle deterministically so train/test split is balanced
  const shuffleRng = mulberry32(42);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  // Stats
  const labelCount = new Map<string, number>();
  const langCount = { de: 0, en: 0, fr: 0 };
  for (const r of rows) {
    for (const l of r.labels) labelCount.set(l, (labelCount.get(l) ?? 0) + 1);
    if (/[äöüßéèêâ]/.test(r.text) || /Personen|Wohnfläche/.test(r.text)) langCount.de++;
    else if (/personnes|maison|chauffage/.test(r.text)) langCount.fr++;
    else langCount.en++;
  }

  console.log(`\nGenerated ${rows.length} multi-label classification examples.`);
  console.log(`  Languages (heuristic):`, langCount);
  console.log(`  Label distribution:`);
  const sortedLabels = Array.from(labelCount.entries()).sort();
  for (const [l, c] of sortedLabels) {
    console.log(`    ${l}: ${c} (${Math.round((c / rows.length) * 100)}%)`);
  }

  const outPath = path.join(process.cwd(), 'data', 'pioneer-classification.jsonl');
  fs.writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\n✓ Wrote ${rows.length} rows to ${outPath}`);
  console.log(`  File size: ${Math.round(fs.statSync(outPath).size / 1024)} KB`);

  // Sample
  console.log('\nSample examples:');
  for (let i = 0; i < 3; i++) {
    console.log(`  ${i + 1}. ${rows[i].text}`);
    console.log(`     labels: ${JSON.stringify(rows[i].labels)}`);
  }
}

main();
