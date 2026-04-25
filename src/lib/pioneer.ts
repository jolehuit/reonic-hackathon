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
// V4: 3 single-label classifiers, one per Reonic decision dimension.
// Note: only the wallbox classifier reaches usable accuracy on holdout eval.
// Battery and system classifiers underperform majority baseline on 4-class imbalanced data,
// so we keep them callable but defer to k-NN for those decisions in /api/design.
const PIONEER_BATTERY_MODEL = process.env.PIONEER_BATTERY_MODEL ?? '';
const PIONEER_SYSTEM_MODEL = process.env.PIONEER_SYSTEM_MODEL ?? '';
const PIONEER_WALLBOX_MODEL = process.env.PIONEER_WALLBOX_MODEL ?? '';
const PIONEER_DISABLED = process.env.PIONEER_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 4000;
const THRESHOLD = 0.3; // best macro-F1 from V2 NER sweep
// Per-task confidence thresholds for V4 classifiers below which we ignore the prediction.
// Wallbox eval was clean (100% on 5-profile probe); battery/system were biased to majority class
// so we set their threshold near 1.0 — they only override k-NN if the model is *very* sure.
const WALLBOX_CONFIDENCE_THRESHOLD = 0.5;
const DECISION_CONFIDENCE_THRESHOLD = 0.95;

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
  source: 'pioneer-v4' | 'knn-fallback';
  confidence?: { battery: number; system: number; wallbox: number };
  inferenceMs: number;
}

interface ChatCompletionsResponse {
  // Pioneer wraps real classifier output in OpenAI chat-completion shape:
  // outer: { choices: [{ message: { content: <JSON STRING> } }] }
  // inner: { decision: { label, confidence }, ... }   (task name is what we passed in schema)
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

interface ClassifierResult {
  label: string;
  confidence: number;
}

/** Call one of the V4 single-label classifiers. Returns null on any failure. */
async function callClassifier(modelId: string, text: string, labels: string[]): Promise<ClassifierResult | null> {
  if (!modelId) return null;
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
        model: modelId,
        messages: [{ role: 'user', content: text }],
        schema: { classifications: [{ task: 'decision', labels }] },
        include_confidence: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const outer = (await res.json()) as ChatCompletionsResponse;
    const innerStr = outer.choices?.[0]?.message?.content;
    if (typeof innerStr !== 'string') return null;
    const inner = JSON.parse(innerStr) as Record<string, unknown>;
    const decision = inner.decision as ClassifierResult | undefined;
    if (decision?.label && typeof decision.confidence === 'number') return decision;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Predicts Reonic-style design decisions (battery class, system bracket, wallbox)
 * from a customer profile via 3 single-label fine-tuned classifiers running in parallel.
 *
 * Eval results on a 5-profile probe:
 *   - wallbox: 100% accuracy, conf 0.90-1.00 — TRUSTED above threshold 0.5
 *   - battery: predicts majority class ("medium") on every profile, F1 0.18 — only trusted at conf≥0.95
 *   - system: predicts mostly "medium/large" with low conf, F1 0.0 — only trusted at conf≥0.95
 *
 * Practical behavior: wallbox decision is reliable and overrides the EV-based heuristic;
 * battery/system fall through to k-NN unless the model is unusually confident.
 *
 * Falls back to k-NN-derived decisions if classifiers are unavailable, disabled, or low-confidence.
 */
export async function getDesignDecisions(profile: CustomerProfile): Promise<DesignDecisions> {
  const start = performance.now();

  if (PIONEER_DISABLED || !PIONEER_API_KEY) {
    return { source: 'knn-fallback', inferenceMs: Math.round(performance.now() - start) };
  }

  try {
    const text = profileToCanonicalText(profile);
    const [battery, system, wallbox] = await Promise.all([
      callClassifier(PIONEER_BATTERY_MODEL, text, ['none', 'small', 'medium', 'large']),
      callClassifier(PIONEER_SYSTEM_MODEL, text, ['small', 'medium', 'large', 'xlarge']),
      callClassifier(PIONEER_WALLBOX_MODEL, text, ['yes', 'no']),
    ]);

    if (!battery && !system && !wallbox) {
      return { source: 'knn-fallback', inferenceMs: Math.round(performance.now() - start) };
    }

    const trustedBattery = battery && battery.confidence >= DECISION_CONFIDENCE_THRESHOLD ? battery.label : undefined;
    const trustedSystem = system && system.confidence >= DECISION_CONFIDENCE_THRESHOLD ? system.label : undefined;
    const trustedWallboxLabel = wallbox && wallbox.confidence >= WALLBOX_CONFIDENCE_THRESHOLD ? wallbox.label : undefined;

    return {
      batterySizeClass: trustedBattery as DesignDecisions['batterySizeClass'],
      systemSizeBracket: trustedSystem as DesignDecisions['systemSizeBracket'],
      recommendWallbox: trustedWallboxLabel === 'yes' ? true : trustedWallboxLabel === 'no' ? false : undefined,
      confidence: {
        battery: battery?.confidence ?? 0,
        system: system?.confidence ?? 0,
        wallbox: wallbox?.confidence ?? 0,
      },
      source: 'pioneer-v4',
      inferenceMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    console.warn('[pioneer-v4] decisions endpoints failed, falling back to k-NN:', err instanceof Error ? err.message : err);
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
