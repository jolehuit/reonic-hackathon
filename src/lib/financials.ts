// Financial computations for solar designs — OWNED by Dev B.
// All constants are 2026 Germany residential, sourced from current EEG / market data.
// Some constants can be overridden at runtime by tavily.ts (e.g. live feed-in tariff).

// --- Market constants (DE 2026 residential <10 kWp) ---
export const FEED_IN_TARIFF = 0.0786;       // €/kWh, EEG Überschusseinspeisung <10 kWp (Aug 2025, dégressif -1% Feb 2026)
export const RETAIL_PRICE = 0.33;           // €/kWh, Verivox January 2026 average
export const CO2_FACTOR = 0.363;            // kg CO2 / kWh, Fraunhofer ISE 2024 (grid mix actuel)
export const ANNUAL_GENERATION_PER_KWP = 1000; // kWh / kWp / year, typical DE south-facing roof

// --- BOM unit prices (installed all-in, 2026 DE residential market) ---
export const PRICE_PER_KWP_INSTALLED = 1100;     // €/kWp (modules + inverter + install + permits)
export const PRICE_PER_KWH_BATTERY = 700;        // €/kWh installed
export const PRICE_HEATPUMP_BASE = 12000;        // € all-in for typical 8-12 kW residential HP
export const PRICE_WALLBOX = 1500;               // € installed 11 kW wallbox

// --- Self-consumption ratios ---
const SELF_CONSUMPTION_NO_BATT = 0.30;
const SELF_CONSUMPTION_WITH_BATT = 0.65;
const SELF_CONSUMPTION_WITH_BATT_AND_HP = 0.75; // HP shifts more load to daytime when sized properly
const SELF_CONSUMPTION_WITH_BATT_AND_EV = 0.72; // EV typically charges in evenings — battery helps less

// --- System lifespan ---
const LIFETIME_YEARS = 25;

export interface FinancialsInput {
  totalKwp: number;
  batteryKwh: number | null;
  heatPumpKw: number | null;
  hasWallbox: boolean;
  annualConsumptionKwh: number;
  hasEv: boolean;
  // Optional runtime overrides (e.g. from Tavily-fetched current tariffs)
  overrides?: {
    feedInTariff?: number;
    retailPrice?: number;
  };
}

export interface FinancialsResult {
  totalPriceEur: number;
  paybackYears: number;
  co2SavedTonsPer25y: number;
  annualSavingsEur: number;
  annualGenerationKwh: number;
  selfConsumptionRatio: number;
  exportedKwh: number;
  selfConsumedKwh: number;
}

export function computeFinancials(input: FinancialsInput): FinancialsResult {
  const feedIn = input.overrides?.feedInTariff ?? FEED_IN_TARIFF;
  const retail = input.overrides?.retailPrice ?? RETAIL_PRICE;

  const annualGenerationKwh = input.totalKwp * ANNUAL_GENERATION_PER_KWP;

  // Determine self-consumption ratio based on system composition
  let selfRatio: number;
  if (!input.batteryKwh) {
    selfRatio = SELF_CONSUMPTION_NO_BATT;
  } else if (input.heatPumpKw && !input.hasEv) {
    selfRatio = SELF_CONSUMPTION_WITH_BATT_AND_HP;
  } else if (input.hasEv && !input.heatPumpKw) {
    selfRatio = SELF_CONSUMPTION_WITH_BATT_AND_EV;
  } else {
    selfRatio = SELF_CONSUMPTION_WITH_BATT;
  }

  // Self-consumed kWh capped at consumption (you can't self-consume more than you use)
  const potentialSelf = annualGenerationKwh * selfRatio;
  const selfConsumedKwh = Math.min(potentialSelf, input.annualConsumptionKwh);
  const exportedKwh = Math.max(0, annualGenerationKwh - selfConsumedKwh);

  // Annual savings = avoided retail cost + feed-in revenue
  const annualSavingsEur = selfConsumedKwh * retail + exportedKwh * feedIn;

  // Total system price
  const solarPrice = input.totalKwp * PRICE_PER_KWP_INSTALLED;
  const batteryPrice = (input.batteryKwh ?? 0) * PRICE_PER_KWH_BATTERY;
  const heatPumpPrice = input.heatPumpKw ? PRICE_HEATPUMP_BASE : 0;
  const wallboxPrice = input.hasWallbox ? PRICE_WALLBOX : 0;
  const totalPriceEur = solarPrice + batteryPrice + heatPumpPrice + wallboxPrice;

  // Payback (simple, no discounting — fine for demo)
  const paybackYears = annualSavingsEur > 0 ? totalPriceEur / annualSavingsEur : 99;

  // CO2 saved over lifetime: every kWh generated displaces grid kWh
  const co2SavedTonsPer25y = (annualGenerationKwh * CO2_FACTOR * LIFETIME_YEARS) / 1000;

  return {
    totalPriceEur: Math.round(totalPriceEur),
    paybackYears: Math.round(paybackYears * 10) / 10,
    co2SavedTonsPer25y: Math.round(co2SavedTonsPer25y * 10) / 10,
    annualSavingsEur: Math.round(annualSavingsEur),
    annualGenerationKwh: Math.round(annualGenerationKwh),
    selfConsumptionRatio: selfRatio,
    exportedKwh: Math.round(exportedKwh),
    selfConsumedKwh: Math.round(selfConsumedKwh),
  };
}
