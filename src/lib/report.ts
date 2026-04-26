// Gemini-generated narrative report — embedded into the PDF "Quick Offer".
//
// Takes the customer-facing numbers + the Tavily incentives lookup and
// returns a short plain-text report (no markdown — jsPDF would need a
// formatter for that). Three sections: summary, key benefits, local
// incentives. Plain paragraphs / bullets so jsPDF can wrap them with
// splitTextToSize.
//
// Gracefully degrades to an empty string if the API key is missing or
// the request fails — the export route then ships the PDF without the
// "Personalised note" section.

import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { IncentiveLookup } from './tavily';
import type { CustomerProfile, DesignResult } from './types';

// Model id is overridable via GEMINI_MODEL env var so the operator can
// pin a specific revision without a redeploy. Default = the model the
// product owner asked for.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
// Hard timeout on the Gemini call. The PDF should never hang for more
// than ~15 s waiting on the report — past that, ship without it.
const GEMINI_TIMEOUT_MS = 15_000;

export async function generateSolarReport(opts: {
  address: string | undefined;
  profile: CustomerProfile;
  design: DesignResult;
  incentives: IncentiveLookup;
}): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return '';

  const modelId = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  const incentivesContext =
    opts.incentives.answer || opts.incentives.results.length > 0
      ? [
          opts.incentives.answer ? `Tavily summary: ${opts.incentives.answer}` : null,
          ...opts.incentives.results
            .slice(0, 3)
            .map((r) => `• ${r.title} — ${r.content.slice(0, 240)}`),
        ]
          .filter(Boolean)
          .join('\n')
      : 'No specific local incentive data available — mention the standard EEG feed-in tariff and BAFA / KfW programmes that apply Germany-wide.';

  const prompt = `You write short, factual customer reports for solar installation quotes. Plain text only — no markdown, no bold, no headers. Write in English.

Address: ${opts.address ?? 'Customer address'}

System specifications (numbers we ship in the quote):
- ${opts.design.moduleCount} × ${opts.design.moduleWattPeak} Wp panels = ${opts.design.totalKwp} kWp total
- Battery: ${opts.design.batteryCapacityKwh ? `${opts.design.batteryCapacityKwh} kWh` : 'none'}
- Heat pump: ${opts.design.heatPumpNominalPowerKw ? `${opts.design.heatPumpNominalPowerKw} kW` : 'none'}
- Wallbox: ${opts.design.wallboxChargeSpeedKw ? `${opts.design.wallboxChargeSpeedKw} kW EV charger` : 'none'}
- Total investment: €${opts.design.totalPriceEur.toLocaleString()}
- Payback: ${opts.design.paybackYears} years
- CO₂ saved over 25 years: ${opts.design.co2SavedTonsPer25y} t
- On-site self-consumption: ${Math.round(opts.design.selfConsumptionRatio * 100)} %

Customer profile:
- Annual electricity use: ${opts.profile.annualConsumptionKwh.toLocaleString()} kWh
- Inhabitants: ${opts.profile.inhabitants}
- Heating: ${opts.profile.heatingType}
- EV: ${opts.profile.hasEv ? `yes (${opts.profile.evAnnualKm ?? '?'} km/year)` : 'no'}

Local incentive context:
${incentivesContext}

Write three short blocks separated by exactly one blank line. Each block starts with one of these uppercase tags on its own line: SUMMARY, KEY BENEFITS, LOCAL INCENTIVES. Then plain prose / bullets. Bullets start with "- ". Keep the whole report under 180 words. Use numbers from the specs above — don't invent. If "No specific local incentive data" was shown, mention the standard German programmes (KfW 270, BAFA, EEG feed-in) instead.`;

  try {
    const result = await Promise.race([
      generateText({
        model: google(modelId),
        prompt,
        temperature: 0.4,
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('gemini timeout')), GEMINI_TIMEOUT_MS),
      ),
    ]);
    return result.text.trim();
  } catch (err) {
    console.warn('[report] Gemini generation failed:', err);
    return '';
  }
}
