// Gemini integration via Vercel AI SDK — OWNED by Dev B
// Used for streaming agent reasoning text into the AgentTrace sidebar.

import { google } from '@ai-sdk/google';
import { streamText } from 'ai';
import type { DesignResult, CustomerProfile } from './types';

const MODEL = google('gemini-3-flash-preview');

export function streamDesignExplanation(
  profile: CustomerProfile,
  design: DesignResult,
) {
  return streamText({
    model: MODEL,
    system: `You are a concise solar design expert. Explain decisions briefly, citing the Reonic dataset matches when relevant.`,
    prompt: buildPrompt(profile, design),
  });
}

function buildPrompt(p: CustomerProfile, d: DesignResult): string {
  return [
    `Customer profile: ${p.annualConsumptionKwh} kWh/yr, ${p.inhabitants} inhabitants, EV: ${p.hasEv}, heating: ${p.heatingType}.`,
    `Designed system: ${d.totalKwp} kWp, ${d.batteryCapacityKwh ?? 'no'} kWh battery.`,
    `Median of ${d.similarProjects.length} similar Reonic projects: ${d.totalKwp + d.deltaVsMedian.kwp} kWp.`,
    `Explain in <80 words why this sizing fits.`,
  ].join('\n');
}
