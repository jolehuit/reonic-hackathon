// Gemini integration via Vercel AI SDK — OWNED by Dev B
// Two roles:
//   1. streamDesignExplanation — streaming text into the AgentTrace sidebar
//   2. parseProfileWithGemini — NL → structured CustomerProfile (used by /api/parse-profile)

import { google } from '@ai-sdk/google';
import { streamText, generateText, Output } from 'ai';
import { z } from 'zod';
import type { CustomerProfile, DesignResult, HeatingType } from './types';

// Model selection: gemini-3-flash-preview is the current fast model.
// (The previous string used dashes — `gemini-2-5-flash` — which 404s on the
// v1beta endpoint; the model identifier wants dots.)
const MODEL_FAST = google('gemini-3-flash-preview');
const MODEL_QUALITY = google('gemini-3-flash-preview');

// --- 1. Streaming explanation for AgentTrace ---

export function streamDesignExplanation(profile: CustomerProfile, design: DesignResult) {
  return streamText({
    model: MODEL_FAST,
    system:
      'You are a concise solar design expert at Iconic. Speak in clear, friendly German with mixed English technical terms (keep brands/units in English). Cite the Iconic dataset matches when relevant.',
    prompt: buildExplanationPrompt(profile, design),
    maxOutputTokens: 200,
  });
}

function buildExplanationPrompt(p: CustomerProfile, d: DesignResult): string {
  return [
    `Customer: ${p.annualConsumptionKwh} kWh/yr, ${p.inhabitants} inhabitants, EV: ${p.hasEv ? 'yes' : 'no'}, heating: ${p.heatingType}, ${p.houseSizeSqm} m².`,
    `Designed system: ${d.totalKwp} kWp · ${d.batteryCapacityKwh ?? 'no'} kWh battery · ${d.heatPumpModel ?? 'no'} HP.`,
    `Reference: median of ${d.similarProjects.length} similar Iconic projects = ${(d.totalKwp + d.deltaVsMedian.kwp).toFixed(1)} kWp.`,
    `Total: €${d.totalPriceEur.toLocaleString('de-DE')}, payback ${d.paybackYears} years, ${d.co2SavedTonsPer25y}t CO₂ saved over 25y.`,
    `Explain in <80 words why this sizing fits the customer profile, mentioning the Iconic match if relevant.`,
  ].join('\n');
}

// --- 2. Structured profile extraction (used by /api/parse-profile) ---

const HEATING_VALUES = ['oil', 'gas', 'heatpump', 'other'] as const satisfies readonly HeatingType[];

const ProfileSchema = z.object({
  annualConsumptionKwh: z.number().min(500).max(50000).optional(),
  inhabitants: z.number().int().min(1).max(8).optional(),
  hasEv: z.boolean().optional(),
  evAnnualKm: z.number().min(0).max(50000).optional(),
  heatingType: z.enum(HEATING_VALUES).optional(),
  houseSizeSqm: z.number().min(20).max(500).optional(),
});

export type ParsedProfile = z.infer<typeof ProfileSchema>;

/**
 * Extracts a structured customer profile from a natural-language description.
 * Powers /api/parse-profile. Latency typically 400-800ms.
 *
 * Uses AI SDK v6 generateText + Output.object pattern (generateObject is deprecated in v6).
 */
export async function parseProfileWithGemini(text: string): Promise<ParsedProfile> {
  const { output } = await generateText({
    model: MODEL_FAST,
    output: Output.object({ schema: ProfileSchema }),
    system:
      'Extract a residential customer profile from the description. ' +
      'Languages: German, English, French. Only fill fields that are explicitly mentioned. ' +
      'Heating types: oil (Öl, Heizöl), gas (Gas, Erdgas), heatpump (Wärmepumpe, pompe à chaleur), other. ' +
      'Convert annual EV km if expressed monthly or weekly.',
    prompt: text,
  });
  return output;
}

export { MODEL_FAST, MODEL_QUALITY };
