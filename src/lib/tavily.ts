// Tavily live-tariff fetch — OWNED by Dev B
// Pulls the current German EEG feed-in tariff so financials.ts can use a fresh number
// instead of hardcoding the August-2025 value. Cache 1h. Falls back to constant on error.
//
// Why partner-level: Tavily is the search partner of the hackathon — by surfacing the
// current tariff in the live demo we demonstrate "real-time data via partner tech".

import { tavily } from '@tavily/core';
import { FEED_IN_TARIFF, RETAIL_PRICE } from './financials';

const API_KEY = process.env.TAVILY_API_KEY ?? '';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface CacheEntry { value: number; at: number; sourceUrl?: string }
const cache = new Map<string, CacheEntry>();

let client: ReturnType<typeof tavily> | null = null;
function getClient() {
  if (!API_KEY) return null;
  if (!client) client = tavily({ apiKey: API_KEY });
  return client;
}

function parseEurPerKwh(text: string): number | null {
  // Match patterns like "7.86 ct/kWh", "0.0786 €/kWh", "8,03 ct/kWh"
  const ct = text.match(/(\d+[.,]\d{1,2})\s*ct(?:\s|\/)?\s*\/?\s*kWh/i);
  if (ct) return parseFloat(ct[1].replace(',', '.')) / 100;
  const eur = text.match(/(0?[.,]\d{2,4})\s*(?:€|EUR)\s*\/?\s*kWh/i);
  if (eur) return parseFloat(eur[1].replace(',', '.'));
  return null;
}

async function searchOnce(query: string, fallback: number): Promise<{ value: number; sourceUrl?: string }> {
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const c = getClient();
  if (!c) {
    cache.set(query, { value: fallback, at: Date.now() });
    return { value: fallback };
  }

  try {
    const res = await c.search(query, {
      searchDepth: 'advanced',
      maxResults: 3,
      includeAnswer: 'advanced',
    });
    // Try the AI-summary answer first, then fall back to scanning result snippets
    const candidates: string[] = [
      typeof res.answer === 'string' ? res.answer : '',
      ...res.results.slice(0, 3).map((r) => r.content ?? ''),
    ].filter(Boolean);

    for (const text of candidates) {
      const parsed = parseEurPerKwh(text);
      if (parsed !== null && parsed > 0 && parsed < 1) {
        const entry = { value: parsed, at: Date.now(), sourceUrl: res.results[0]?.url };
        cache.set(query, entry);
        return entry;
      }
    }
  } catch (err) {
    console.warn('[tavily] search failed, using fallback:', err instanceof Error ? err.message : err);
  }

  cache.set(query, { value: fallback, at: Date.now() });
  return { value: fallback };
}

export async function getFeedInTariff(): Promise<{ value: number; sourceUrl?: string }> {
  return searchOnce(
    'current EEG solar feed-in tariff Germany 2026 ct/kWh residential under 10 kWp',
    FEED_IN_TARIFF,
  );
}

export async function getResidentialElectricityPrice(): Promise<{ value: number; sourceUrl?: string }> {
  return searchOnce(
    'average residential electricity price Germany 2026 €/kWh Verivox',
    RETAIL_PRICE,
  );
}

/**
 * Warms the cache with both tariffs in parallel. Call on first request to /api/design.
 */
export async function warmTariffs() {
  await Promise.all([getFeedInTariff(), getResidentialElectricityPrice()]);
}
