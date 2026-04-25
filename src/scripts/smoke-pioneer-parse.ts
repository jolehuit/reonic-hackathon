// Test the Pioneer NER response parser with real-shape mocks.
// Run: pnpm tsx src/scripts/smoke-pioneer-parse.ts

import type { ParsedProfile } from '../lib/gemini';

interface PioneerEntitySpan { text: string; start: number; end: number; confidence: number }

function parseFirstNumber(spans: PioneerEntitySpan[] | undefined) {
  if (!spans?.length) return undefined;
  let s = spans[0].text.trim();
  if (/^\d{1,3}([.,\s]\d{3})+$/.test(s)) s = s.replace(/[.,\s]/g, '');
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

const HAS_EV_YES_KW = ['e-auto', 'elektroauto', 'e-fahrzeug', 'electric vehicle', 'tesla', 'ev', 've', 'véhicule électrique', 'yes', 'oui', 'ja'];
const HAS_EV_NO_KW = ['kein elektroauto', 'no ev', 'no electric vehicle', 'not own an electric', "don't own", 'do not own', 'pas de véhicule électrique', 'sans ve', 'without ev'];

function normalizeHasEv(spans: PioneerEntitySpan[] | undefined, fullText: string, evKm: number | undefined) {
  if (spans?.length) {
    const t = spans.map((s) => s.text.toLowerCase().trim()).join(' ');
    for (const kw of HAS_EV_NO_KW) if (t.includes(kw)) return false;
    for (const kw of HAS_EV_YES_KW) if (t.includes(kw)) return true;
  }
  if (evKm !== undefined && evKm > 0) return true;
  const lower = fullText.toLowerCase();
  for (const kw of HAS_EV_NO_KW) if (lower.includes(kw)) return false;
  for (const kw of HAS_EV_YES_KW) if (lower.includes(kw)) return true;
  return undefined;
}

const HEATING_MAP: Record<string, ParsedProfile['heatingType']> = {
  'öl': 'oil', 'oil': 'oil', 'fioul': 'oil', 'ölheizung': 'oil',
  'gas': 'gas', 'gaz': 'gas', 'gasheizung': 'gas',
  'wärmepumpe': 'heatpump', 'heatpump': 'heatpump', 'pompe à chaleur': 'heatpump',
  'sonstige': 'other', 'other': 'other', 'autre': 'other',
};
function normalizeHeating(spans: PioneerEntitySpan[] | undefined) {
  for (const s of spans ?? []) {
    const key = s.text.toLowerCase().trim();
    if (HEATING_MAP[key]) return HEATING_MAP[key];
  }
  return undefined;
}

interface PioneerResp {
  entities: Record<string, PioneerEntitySpan[]>;
}

function parse(r: PioneerResp, originalText: string): ParsedProfile {
  const ent = r.entities;
  const evKm = parseFirstNumber(ent.ev_annual_km);
  return {
    inhabitants: parseFirstNumber(ent.inhabitants_count),
    houseSizeSqm: parseFirstNumber(ent.house_size_sqm),
    annualConsumptionKwh: parseFirstNumber(ent.annual_consumption_kwh),
    evAnnualKm: evKm,
    hasEv: normalizeHasEv(ent.has_ev, originalText, evKm),
    heatingType: normalizeHeating(ent.heating_type),
  };
}

const cases: { name: string; text: string; raw: PioneerResp; expect: ParsedProfile }[] = [
  {
    name: 'Real Pioneer Playground EN response — has_ev fallback via regex on text',
    text: 'We are a family of 4 living in a 180 m² house in Berlin. Our annual electricity consumption is 5000 kWh, we use gas heating, and we do not own an electric vehicle.',
    raw: {
      entities: {
        has_ev: [],
        ev_annual_km: [],
        heating_type: [{ text: 'gas', start: 112, end: 115, confidence: 1 }],
        house_size_sqm: [{ text: '180', start: 33, end: 36, confidence: 1 }],
        inhabitants_count: [{ text: '4', start: 19, end: 20, confidence: 1 }],
        annual_consumption_kwh: [{ text: '5000', start: 95, end: 99, confidence: 1 }],
      },
    },
    expect: {
      inhabitants: 4,
      houseSizeSqm: 180,
      annualConsumptionKwh: 5000,
      evAnnualKm: undefined,
      hasEv: false, // recovered via regex fallback on "do not own an electric"
      heatingType: 'gas',
    },
  },
  {
    name: 'DE: kein Elektroauto explicitly tagged',
    text: 'Wir sind 4 Personen, 180m² Haus, Gasheizung, 5000 kWh, kein Elektroauto.',
    raw: {
      entities: {
        inhabitants_count: [{ text: '4', start: 9, end: 10, confidence: 1 }],
        house_size_sqm: [{ text: '180', start: 22, end: 25, confidence: 1 }],
        annual_consumption_kwh: [{ text: '5000', start: 45, end: 49, confidence: 1 }],
        ev_annual_km: [],
        has_ev: [{ text: 'kein Elektroauto', start: 56, end: 71, confidence: 0.95 }],
        heating_type: [{ text: 'Gas', start: 30, end: 33, confidence: 1 }],
      },
    },
    expect: {
      inhabitants: 4,
      houseSizeSqm: 180,
      annualConsumptionKwh: 5000,
      evAnnualKm: undefined,
      hasEv: false,
      heatingType: 'gas',
    },
  },
  {
    name: 'EN with EV: implicit EV via ev_annual_km populated',
    text: 'Family of 3, 150 sqm, 4500 kWh/year, heatpump, drives 15000 km/year electric.',
    raw: {
      entities: {
        inhabitants_count: [{ text: '3', start: 10, end: 11, confidence: 1 }],
        house_size_sqm: [{ text: '150', start: 13, end: 16, confidence: 1 }],
        annual_consumption_kwh: [{ text: '4500', start: 22, end: 26, confidence: 1 }],
        ev_annual_km: [{ text: '15000', start: 53, end: 58, confidence: 1 }],
        has_ev: [], // not tagged explicitly, recovered via ev_annual_km > 0
        heating_type: [{ text: 'heatpump', start: 37, end: 45, confidence: 1 }],
      },
    },
    expect: {
      inhabitants: 3,
      houseSizeSqm: 150,
      annualConsumptionKwh: 4500,
      evAnnualKm: 15000,
      hasEv: true,
      heatingType: 'heatpump',
    },
  },
  {
    name: 'FR: chauffage fioul, no EV mentioned',
    text: 'Personne seule, 75m², 2800 kWh/an, chauffage fioul.',
    raw: {
      entities: {
        inhabitants_count: [{ text: '1', start: 0, end: 0, confidence: 0.5 }], // hypothetical
        house_size_sqm: [{ text: '75', start: 16, end: 18, confidence: 1 }],
        annual_consumption_kwh: [{ text: '2800', start: 22, end: 26, confidence: 1 }],
        ev_annual_km: [],
        has_ev: [],
        heating_type: [{ text: 'fioul', start: 45, end: 50, confidence: 1 }],
      },
    },
    expect: {
      inhabitants: 1,
      houseSizeSqm: 75,
      annualConsumptionKwh: 2800,
      evAnnualKm: undefined,
      hasEv: undefined, // no signal anywhere
      heatingType: 'oil',
    },
  },
  {
    name: 'Thousand-separator handling: "12.500" → 12500',
    text: 'Tesla owner driving 12.500 km/year.',
    raw: {
      entities: {
        ev_annual_km: [{ text: '12.500', start: 20, end: 26, confidence: 1 }],
        has_ev: [{ text: 'Tesla', start: 0, end: 5, confidence: 1 }],
        inhabitants_count: [],
        house_size_sqm: [],
        annual_consumption_kwh: [],
        heating_type: [],
      },
    },
    expect: {
      inhabitants: undefined,
      houseSizeSqm: undefined,
      annualConsumptionKwh: undefined,
      evAnnualKm: 12500,
      hasEv: true,
      heatingType: undefined,
    },
  },
];

let passed = 0; let failed = 0;
for (const tc of cases) {
  const got = parse(tc.raw, tc.text);
  const ok =
    got.inhabitants === tc.expect.inhabitants &&
    got.houseSizeSqm === tc.expect.houseSizeSqm &&
    got.annualConsumptionKwh === tc.expect.annualConsumptionKwh &&
    got.evAnnualKm === tc.expect.evAnnualKm &&
    got.hasEv === tc.expect.hasEv &&
    got.heatingType === tc.expect.heatingType;
  if (ok) { console.log(`  ✓ ${tc.name}`); passed++; }
  else { console.log(`  ✗ ${tc.name}\n    expect:`, tc.expect, '\n    got:   ', got); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
