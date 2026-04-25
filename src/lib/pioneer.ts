// Pioneer (Fastino) integration — OWNED by Dev B
// Single role: NL → CustomerProfile extraction via fine-tuned GLiNER2 NER.
//
// Fine-tuned at Big Berlin Hack 2026 on 4025 NER examples derived from 805 anchor profiles
// in data/pioneer-seeds.jsonl. Eval vs base model: macro F1 0.871 vs 0.342 (+52.8 points).
// Matches Qwen3-8B frontier baseline (F1 0.872) at 41× smaller model + 6× lower latency.
//
// Replaces a generic Gemini structured-output call.
// Falls back to Gemini structured output if Pioneer endpoint is down or PIONEER_DISABLED=true.

import { parseProfileWithGemini, type ParsedProfile } from './gemini';

const PIONEER_API_URL = process.env.PIONEER_API_URL ?? 'https://api.pioneer.ai/v1/chat/completions';
const PIONEER_API_KEY = process.env.PIONEER_API_KEY ?? '';
const PIONEER_MODEL = process.env.PIONEER_MODEL ?? 'reonic-profile-extractor-v1';
const PIONEER_DISABLED = process.env.PIONEER_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 4000;

const SCHEMA_ENTITIES = [
  'inhabitants_count',
  'house_size_sqm',
  'annual_consumption_kwh',
  'ev_annual_km',
  'has_ev',
  'heating_type',
] as const;

export type ProfileSource = 'pioneer-ft' | 'gemini-fallback';

export interface ParseProfileResult {
  profile: ParsedProfile;
  source: ProfileSource;
  inferenceMs: number;
}

/** Real Pioneer chat-completions response (verified via Playground). */
interface PioneerEntitySpan {
  text: string;
  start: number;
  end: number;
  confidence: number;
}
interface PioneerResponse {
  entities: Partial<Record<(typeof SCHEMA_ENTITIES)[number], PioneerEntitySpan[]>>;
  token_usage?: number;
  input_tokens?: number;
  output_tokens?: number;
}

// --- Normalizers (NER spans → typed values) ---

function parseFirstNumber(spans: PioneerEntitySpan[] | undefined): number | undefined {
  if (!spans?.length) return undefined;
  let s = spans[0].text.trim();
  // Strip thousand separators when pattern is XX.YYY or XX,YYY (groups of exactly 3 digits)
  if (/^\d{1,3}([.,\s]\d{3})+$/.test(s)) {
    s = s.replace(/[.,\s]/g, '');
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

const HAS_EV_YES_KW = ['e-auto', 'elektroauto', 'e-fahrzeug', 'electric vehicle', 'tesla', 'ev', 've', 'véhicule électrique', 'yes', 'oui', 'ja'];
const HAS_EV_NO_KW = ['kein elektroauto', 'no ev', 'no electric vehicle', 'not own an electric', "don't own", 'do not own', 'pas de véhicule électrique', 'sans ve', 'without ev', 'aucun véhicule électrique'];

function normalizeHasEv(spans: PioneerEntitySpan[] | undefined, fullText: string, evKm: number | undefined): boolean | undefined {
  // Step 1: trust extracted span if present
  if (spans?.length) {
    const text = spans.map((s) => s.text.toLowerCase().trim()).join(' ');
    for (const kw of HAS_EV_NO_KW) if (text.includes(kw)) return false;
    for (const kw of HAS_EV_YES_KW) if (text.includes(kw)) return true;
  }
  // Step 2: if ev_annual_km is populated, EV is implicit
  if (evKm !== undefined && evKm > 0) return true;
  // Step 3: post-hoc regex on original text — catches negative phrasings the model didn't tag
  const lower = fullText.toLowerCase();
  for (const kw of HAS_EV_NO_KW) if (lower.includes(kw)) return false;
  for (const kw of HAS_EV_YES_KW) if (lower.includes(kw)) return true;
  return undefined;
}

const HEATING_MAP: Record<string, ParsedProfile['heatingType']> = {
  'öl': 'oil', 'oel': 'oil', 'oil': 'oil', 'fioul': 'oil', 'ölheizung': 'oil', 'heizöl': 'oil',
  'gas': 'gas', 'gaz': 'gas', 'gasheizung': 'gas', 'erdgas': 'gas',
  'wärmepumpe': 'heatpump', 'waermepumpe': 'heatpump', 'heatpump': 'heatpump',
  'heat pump': 'heatpump', 'pompe à chaleur': 'heatpump', 'wärmepumpenheizung': 'heatpump',
  'sonstige': 'other', 'other': 'other', 'autre': 'other', 'sonstigeheizung': 'other',
};

function normalizeHeating(spans: PioneerEntitySpan[] | undefined): ParsedProfile['heatingType'] | undefined {
  if (!spans?.length) return undefined;
  for (const s of spans) {
    const key = s.text.toLowerCase().trim();
    if (HEATING_MAP[key]) return HEATING_MAP[key];
  }
  return undefined;
}

function pioneerToProfile(r: PioneerResponse, originalText: string): ParsedProfile {
  const ent = r.entities ?? {};
  const evAnnualKm = parseFirstNumber(ent.ev_annual_km);
  return {
    inhabitants: parseFirstNumber(ent.inhabitants_count),
    houseSizeSqm: parseFirstNumber(ent.house_size_sqm),
    annualConsumptionKwh: parseFirstNumber(ent.annual_consumption_kwh),
    evAnnualKm,
    hasEv: normalizeHasEv(ent.has_ev, originalText, evAnnualKm),
    heatingType: normalizeHeating(ent.heating_type),
  };
}

async function callPioneer(text: string): Promise<ParsedProfile> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(PIONEER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PIONEER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PIONEER_MODEL,
        messages: [{ role: 'user', content: text }],
        schema: { entities: SCHEMA_ENTITIES },
        include_confidence: true,
        include_spans: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Pioneer ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as PioneerResponse;
    return pioneerToProfile(json, text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses a natural-language description into a structured CustomerProfile.
 * Tries Pioneer's fine-tuned GLiNER2 first, falls back to Gemini structured output.
 */
export async function parseProfileFromNL(text: string): Promise<ParseProfileResult> {
  const start = performance.now();

  if (!PIONEER_DISABLED && PIONEER_API_KEY && PIONEER_MODEL) {
    try {
      const profile = await callPioneer(text);
      const fieldsExtracted = Object.values(profile).filter((v) => v !== undefined).length;
      if (fieldsExtracted > 0) {
        return {
          profile,
          source: 'pioneer-ft',
          inferenceMs: Math.round(performance.now() - start),
        };
      }
    } catch (err) {
      console.warn('[pioneer] fine-tune endpoint failed, falling back to Gemini:', err instanceof Error ? err.message : err);
    }
  }

  const profile = await parseProfileWithGemini(text);
  return {
    profile,
    source: 'gemini-fallback',
    inferenceMs: Math.round(performance.now() - start),
  };
}
