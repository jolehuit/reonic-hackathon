// Pioneer (Fastino) integration — OWNED by Dev B
// Single role: NL → CustomerProfile extraction via fine-tuned GLiNER2 (V2 multi-task NER).
//
// Model: reonic-profile-and-decision-extractor-v2 (job c13d09a2-7aa9-4826-a723-ef1012d13b7b)
// Fine-tuned at Big Berlin Hack 2026 on 4828 multilingual examples derived from 805 anchor profiles.
//
// Eval (966-row holdout):
//   Extraction F1: 0.089 (base) → 0.731 (fine-tuned), +0.642 absolute
//   Classification F1: 0.353 → 0.889, +0.536 absolute
//   Replaces a Gemini structured-output API call.
//
// Note: the model also predicts decision labels (battery_size_class, system_size_bracket,
// recommend_wallbox) but only when the suffix [battery:?|system:?|wallbox:?] is present
// AND the model has confident pattern matches. We don't rely on decisions for /api/design
// (k-NN handles sizing on real BOM patterns); we use Pioneer for the NL extraction job
// where it genuinely outperforms generic LLMs.
//
// Falls back to Gemini structured output if Pioneer endpoint is down or PIONEER_DISABLED=true.

import { parseProfileWithGemini, type ParsedProfile } from './gemini';
import type { CustomerProfile } from './types';

const PIONEER_API_URL = process.env.PIONEER_API_URL ?? 'https://api.pioneer.ai/v1/chat/completions';
const PIONEER_API_KEY = process.env.PIONEER_API_KEY ?? '';
// V2: NER model for extraction (numeric + has_ev/heating)
const PIONEER_MODEL = process.env.PIONEER_MODEL ?? 'c13d09a2-7aa9-4826-a723-ef1012d13b7b';
// V3: classifier model for decisions (battery/system/wallbox). Set when V3 fine-tune is ready.
const PIONEER_DECISIONS_MODEL = process.env.PIONEER_DECISIONS_MODEL ?? '';
const PIONEER_DISABLED = process.env.PIONEER_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 4000;
const THRESHOLD = 0.3; // best macro-F1 from sweep
const DECISION_CONFIDENCE_THRESHOLD = 0.55; // below this, fall back to k-NN

// V2 schema: 4 numeric entities + 6 split classification entities + 3 decision entities
const SCHEMA = [
  // Numeric extractions
  'inhabitants_count',
  'house_size_sqm',
  'annual_consumption_kwh',
  'ev_annual_km',
  // Classifications, split per class
  'has_ev_yes',
  'has_ev_no',
  'heating_gas',
  'heating_heatpump',
  'heating_oil',
  'heating_other',
  // Decisions (only meaningful when suffix is present in input)
  'battery_size_class',
  'system_size_bracket',
  'recommend_wallbox',
] as const;

export type ProfileSource = 'pioneer-ft' | 'gemini-fallback';

export interface ParseProfileResult {
  profile: ParsedProfile;
  source: ProfileSource;
  inferenceMs: number;
  decisions?: PioneerDecisions;
}

export interface PioneerDecisions {
  batterySizeClass?: 'none' | 'small' | 'medium' | 'large';
  systemSizeBracket?: 'small' | 'medium' | 'large' | 'xlarge';
  recommendWallbox?: boolean;
}

interface PioneerV2Response {
  result?: {
    entities?: Partial<Record<(typeof SCHEMA)[number], string[]>>;
  };
  // Some endpoints flatten the entities at top-level — handle both shapes.
  entities?: Partial<Record<(typeof SCHEMA)[number], string[]>>;
}

// --- Span normalizers ---

function parseFirstNumber(spans: string[] | undefined): number | undefined {
  if (!spans?.length) return undefined;
  let s = spans[0].trim();
  // Strip thousand separators when grouped (e.g. "9.200" → 9200, "12,500" → 12500)
  if (/^\d{1,3}([.,\s]\d{3})+$/.test(s)) s = s.replace(/[.,\s]/g, '');
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

function pickFirstClass<T extends string>(
  ent: PioneerV2Response['entities'] | undefined,
  options: ReadonlyArray<{ key: (typeof SCHEMA)[number]; value: T }>,
): T | undefined {
  for (const o of options) {
    if ((ent?.[o.key]?.length ?? 0) > 0) return o.value;
  }
  return undefined;
}

function v2ToProfile(r: PioneerV2Response, originalText: string): { profile: ParsedProfile; decisions: PioneerDecisions } {
  const ent = r.result?.entities ?? r.entities ?? {};

  const evKm = parseFirstNumber(ent.ev_annual_km);

  // has_ev: prefer split entities (yes/no), fall back to ev_annual_km signal,
  // then to keyword regex on the original text (catches phrasings the model didn't tag).
  let hasEv: boolean | undefined;
  if (ent.has_ev_yes?.length) hasEv = true;
  else if (ent.has_ev_no?.length) hasEv = false;
  else if (evKm !== undefined && evKm > 0) hasEv = true;
  else {
    const lower = originalText.toLowerCase();
    if (/(kein elektroauto|no ev|no electric vehicle|do not own an electric|don't own|pas de v[eé]hicule [eé]lectrique)/.test(lower)) hasEv = false;
    else if (/(e-auto|elektroauto|tesla|electric vehicle|véhicule électrique)/.test(lower)) hasEv = true;
  }

  const heatingType = pickFirstClass(ent, [
    { key: 'heating_gas', value: 'gas' as const },
    { key: 'heating_heatpump', value: 'heatpump' as const },
    { key: 'heating_oil', value: 'oil' as const },
    { key: 'heating_other', value: 'other' as const },
  ]);

  const profile: ParsedProfile = {
    inhabitants: parseFirstNumber(ent.inhabitants_count),
    houseSizeSqm: parseFirstNumber(ent.house_size_sqm),
    annualConsumptionKwh: parseFirstNumber(ent.annual_consumption_kwh),
    evAnnualKm: evKm,
    hasEv,
    heatingType,
  };

  const decisions: PioneerDecisions = {
    batterySizeClass: ent.battery_size_class?.[0]?.toLowerCase() as PioneerDecisions['batterySizeClass'],
    systemSizeBracket: ent.system_size_bracket?.[0]?.toLowerCase() as PioneerDecisions['systemSizeBracket'],
    recommendWallbox: ent.recommend_wallbox?.[0]?.toLowerCase() === 'yes' ? true
      : ent.recommend_wallbox?.[0]?.toLowerCase() === 'no' ? false
      : undefined,
  };

  return { profile, decisions };
}

async function callPioneer(text: string): Promise<{ profile: ParsedProfile; decisions: PioneerDecisions }> {
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
        task: 'extract_entities',
        text,
        schema: SCHEMA,
        threshold: THRESHOLD,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Pioneer ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as PioneerV2Response;
    return v2ToProfile(json, text);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V3 — Decision classifier
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignDecisions {
  batterySizeClass?: 'none' | 'small' | 'medium' | 'large';
  systemSizeBracket?: 'small' | 'medium' | 'large' | 'xlarge';
  recommendWallbox?: boolean;
  source: 'pioneer-v3' | 'knn-fallback';
  confidence?: { battery: number; system: number; wallbox: number };
  inferenceMs: number;
}

interface PioneerV3Response {
  // Multi-label classification: same chat-completion wrap as V2
  // Outer: { choices: [{ message: { content: <JSON STRING> } }] }
  // Inner: { labels: [{ label: "bat_medium", confidence: 0.87 }, ...] }
  // OR (legacy): { classifications: { task_name: { label, confidence } } }
  choices?: Array<{ message?: { content?: string } }>;
}

/** Convert a CustomerProfile (form data) into the canonical text the V3 model was trained on. */
export function profileToCanonicalText(p: CustomerProfile): string {
  const heatingDe: Record<CustomerProfile['heatingType'], string> = {
    oil: 'Ölheizung',
    gas: 'Gasheizung',
    heatpump: 'Wärmepumpe',
    other: 'andere Heizung',
  };
  const ev = p.hasEv
    ? `Wir haben ein Elektroauto und fahren ca. ${p.evAnnualKm ?? 12000} km pro Jahr.`
    : 'Kein Elektroauto.';
  return `Familie mit ${p.inhabitants} Personen, Einfamilienhaus ${Math.round(p.houseSizeSqm)} m², Jahresverbrauch ${Math.round(p.annualConsumptionKwh)} kWh, ${heatingDe[p.heatingType]}. ${ev}`;
}

interface ParsedDecisions {
  battery?: { label: string; confidence: number };
  system?: { label: string; confidence: number };
  wallbox?: { label: string; confidence: number };
}

function parseV3Inner(inner: unknown): ParsedDecisions {
  if (!inner || typeof inner !== 'object') return {};
  const obj = inner as Record<string, unknown>;
  const out: ParsedDecisions = {};

  // Shape A — multi-label: { labels: [{label, confidence}, ...] }
  const labels = obj.labels;
  if (Array.isArray(labels)) {
    for (const item of labels) {
      if (!item || typeof item !== 'object') continue;
      const { label, confidence } = item as { label?: string; confidence?: number };
      if (typeof label !== 'string' || typeof confidence !== 'number') continue;
      if (label.startsWith('bat_') && (!out.battery || out.battery.confidence < confidence)) out.battery = { label: label.slice(4), confidence };
      if (label.startsWith('sys_') && (!out.system || out.system.confidence < confidence)) out.system = { label: label.slice(4), confidence };
      if (label.startsWith('wallbox_') && (!out.wallbox || out.wallbox.confidence < confidence)) out.wallbox = { label: label.slice(8), confidence };
    }
    return out;
  }

  // Shape B — per-task: { battery_size_class: { label, confidence }, ... }
  const batt = obj.battery_size_class as { label?: string; confidence?: number } | undefined;
  const sys = obj.system_size_bracket as { label?: string; confidence?: number } | undefined;
  const wb = obj.recommend_wallbox as { label?: string; confidence?: number } | undefined;
  if (batt?.label && typeof batt.confidence === 'number') out.battery = { label: batt.label, confidence: batt.confidence };
  if (sys?.label && typeof sys.confidence === 'number') out.system = { label: sys.label, confidence: sys.confidence };
  if (wb?.label && typeof wb.confidence === 'number') out.wallbox = { label: wb.label, confidence: wb.confidence };
  return out;
}

async function callDecisionsModel(text: string): Promise<ParsedDecisions> {
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
        model: PIONEER_DECISIONS_MODEL,
        messages: [{ role: 'user', content: text }],
        // V3 expects a multi-label classification schema. Flat array of all possible labels.
        schema: {
          classifications: [
            { task: 'battery_size_class', labels: ['none', 'small', 'medium', 'large'] },
            { task: 'system_size_bracket', labels: ['small', 'medium', 'large', 'xlarge'] },
            { task: 'recommend_wallbox', labels: ['yes', 'no'] },
          ],
        },
        include_confidence: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Pioneer V3 ${res.status}: ${await res.text()}`);
    const outer = (await res.json()) as PioneerV3Response;
    const innerStr = outer.choices?.[0]?.message?.content;
    let inner: unknown = outer; // fallback: outer might already be flat
    if (typeof innerStr === 'string') {
      try { inner = JSON.parse(innerStr); } catch { /* keep outer */ }
    }
    return parseV3Inner(inner);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Predicts Reonic-style design decisions (battery class, system bracket, wallbox)
 * from a customer profile. Used by /api/design alongside k-NN sizing.
 *
 * Falls back to k-NN-derived decisions if V3 is unavailable, disabled, or low-confidence.
 */
export async function getDesignDecisions(profile: CustomerProfile): Promise<DesignDecisions> {
  const start = performance.now();

  if (PIONEER_DISABLED || !PIONEER_API_KEY || !PIONEER_DECISIONS_MODEL) {
    return { source: 'knn-fallback', inferenceMs: Math.round(performance.now() - start) };
  }

  try {
    const text = profileToCanonicalText(profile);
    const d = await callDecisionsModel(text);
    const battery = d.battery && d.battery.confidence >= DECISION_CONFIDENCE_THRESHOLD ? d.battery.label : undefined;
    const system = d.system && d.system.confidence >= DECISION_CONFIDENCE_THRESHOLD ? d.system.label : undefined;
    const wallbox = d.wallbox && d.wallbox.confidence >= DECISION_CONFIDENCE_THRESHOLD ? d.wallbox.label : undefined;

    return {
      batterySizeClass: battery as DesignDecisions['batterySizeClass'],
      systemSizeBracket: system as DesignDecisions['systemSizeBracket'],
      recommendWallbox: wallbox === 'yes' ? true : wallbox === 'no' ? false : undefined,
      confidence: {
        battery: d.battery?.confidence ?? 0,
        system: d.system?.confidence ?? 0,
        wallbox: d.wallbox?.confidence ?? 0,
      },
      source: 'pioneer-v3',
      inferenceMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    console.warn('[pioneer-v3] decisions endpoint failed, falling back to k-NN:', err instanceof Error ? err.message : err);
    return { source: 'knn-fallback', inferenceMs: Math.round(performance.now() - start) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 — NL extraction (existing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a natural-language description into a structured CustomerProfile.
 * Tries Pioneer's fine-tuned GLiNER2 first, falls back to Gemini structured output.
 */
export async function parseProfileFromNL(text: string): Promise<ParseProfileResult> {
  const start = performance.now();

  if (!PIONEER_DISABLED && PIONEER_API_KEY && PIONEER_MODEL) {
    try {
      const { profile, decisions } = await callPioneer(text);
      const fieldsExtracted = Object.values(profile).filter((v) => v !== undefined).length;
      if (fieldsExtracted > 0) {
        return {
          profile,
          decisions,
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
