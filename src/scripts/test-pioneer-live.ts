// Live test the Pioneer fine-tuned model.
// Run: pnpm tsx src/scripts/test-pioneer-live.ts
//
// Reads from .env.local:
//   PIONEER_API_URL  (default: https://api.pioneer.ai/v1/chat/completions)
//   PIONEER_API_KEY
//   PIONEER_MODEL    (e.g. reonic-profile-and-decision-extractor-v2)
//
// Outputs:
//   - Full raw JSON response from Pioneer (for shape inspection)
//   - Parsed CustomerProfile via our pioneer.ts wrapper
//   - Latency
//
// Use this BEFORE updating pioneer.ts to confirm the V2 multi-task response shape.

// Load .env.local manually (no dotenv dep) — Next.js convention.
import fs from 'node:fs';
import path from 'node:path';
const envFile = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
import { parseProfileFromNL } from '../lib/pioneer';

const SUFFIX = ' [battery:?|system:?|wallbox:?]';

const TEST_INPUTS = [
  // Plain extraction (no suffix) — should populate entities, NO decisions
  { lang: 'DE no-suffix', text: 'Wir sind eine 4-köpfige Familie in Berlin, 180m² Haus, Gasheizung, 5000 kWh/Jahr, kein Elektroauto.' },
  // CRITICAL TEST: with ?-placeholder suffix — does the model PREDICT decision values?
  { lang: 'DE +placeholder', text: 'Wir sind eine 4-köpfige Familie in Berlin, 180m² Haus, Gasheizung, 5000 kWh/Jahr, kein Elektroauto.' + SUFFIX },
  { lang: 'DE+EV +placeholder', text: 'Familie von 5, 240m² Einfamilienhaus, Wärmepumpe, 8000 kWh/Jahr, Tesla Model 3 mit ca. 18000 km/Jahr.' + SUFFIX },
  { lang: 'EN +placeholder', text: 'Family of 4 living in a 180 m² house in Berlin. Annual electricity 5000 kWh, gas heating, no EV.' + SUFFIX },
  { lang: 'EN+EV +placeholder', text: '3 people in 150 m² home, heat pump heating, 4500 kWh per year, electric car driving 12000 km annually.' + SUFFIX },
  { lang: 'FR +placeholder', text: 'Famille de 4, maison de 110m², chauffage au gaz, 4000 kWh/an, pas de voiture électrique.' + SUFFIX },
  // Edge: small house, oil, no EV — should map to small/medium/no
  { lang: 'tiny +placeholder', text: '2 Pers., 100m², 2500 kWh, Öl, kein EV.' + SUFFIX },
  // Edge: very large house, lots of consumption — should map to xlarge bracket
  { lang: 'large +placeholder', text: 'Single homeowner, 320 m² mansion, oil heating, 12000 kWh/year, no electric vehicle.' + SUFFIX },
];

const FULL_SCHEMA = [
  'inhabitants_count', 'house_size_sqm', 'annual_consumption_kwh', 'ev_annual_km',
  'has_ev_yes', 'has_ev_no',
  'heating_gas', 'heating_heatpump', 'heating_oil', 'heating_other',
  'battery_size_class', 'system_size_bracket', 'recommend_wallbox',
];

async function rawCall(url: string, key: string, model: string, text: string) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      task: 'extract_entities',
      text,
      schema: FULL_SCHEMA,
      threshold: 0.3,
    }),
  });
  const ms = Math.round(performance.now() - t0);
  const body = await res.text();
  let json: unknown;
  try { json = JSON.parse(body); } catch { json = body; }
  return { status: res.status, ms, json };
}

async function main() {
  const url = process.env.PIONEER_API_URL ?? 'https://api.pioneer.ai/v1/chat/completions';
  const key = process.env.PIONEER_API_KEY ?? '';
  const model = process.env.PIONEER_MODEL ?? '';

  if (!key || !model) {
    console.error('Missing PIONEER_API_KEY or PIONEER_MODEL in .env.local');
    process.exit(1);
  }

  console.log(`Testing Pioneer model: ${model}`);
  console.log(`Endpoint: ${url}\n`);

  // STEP 1 — print FULL raw response on the placeholder-suffix variant.
  // KEY QUESTION: does the model FILL IN ?-placeholders with predicted decision values?
  console.log('═══ CRITICAL TEST: placeholder suffix [battery:?|system:?|wallbox:?] ═══');
  const probe = TEST_INPUTS.find((t) => t.lang.includes('+placeholder'))!;
  const first = await rawCall(url, key, model, probe.text);
  console.log(`Input: ${probe.text}`);
  console.log(`HTTP ${first.status} in ${first.ms}ms`);
  console.log('Raw response:');
  console.log(JSON.stringify(first.json, null, 2));
  console.log();
  console.log('═══ INTERPRETATION ═══');
  console.log('  - If battery_size_class/system_size_bracket/recommend_wallbox span = "?"');
  console.log('    → model PARSES the suffix, no real prediction');
  console.log('  - If span = "medium" / "small" / "no" / etc.');
  console.log('    → model PREDICTS — we have decisions for free');
  console.log();

  if (first.status !== 200) {
    console.error('Endpoint returned non-200, aborting test loop.');
    process.exit(1);
  }

  // STEP 2 — full sweep through all variants via our parser
  console.log('═══ PARSED via pioneer.ts wrapper (all variants) ═══');
  for (const { lang, text } of TEST_INPUTS) {
    const r = await parseProfileFromNL(text);
    console.log(`\n[${lang}] "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
    console.log(`  source: ${r.source}  inferenceMs: ${r.inferenceMs}`);
    console.log(`  profile:`, r.profile);
    if (r.decisions && Object.values(r.decisions).some((v) => v !== undefined)) {
      console.log(`  decisions:`, r.decisions);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
