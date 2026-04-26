// Disk cache for /api/design results — covers k-NN sizing, financials, and
// the full DesignResult envelope. Aerial PNGs and roof geometry already have
// their own caches; this layer caches the k-NN/pricing pipeline that runs
// AFTER geometry resolution so identical (houseId, profile) pairs return in
// ~5 ms instead of ~250 ms.
//
// Cache key = sha1(ALGO_VERSION | houseId | profileNormalised). Bumping
// ALGO_VERSION invalidates the entire cache — use this whenever sizing.ts,
// financials.ts, or the Reonic dataset changes.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CustomerProfile, DesignResult } from './types';

const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'design');
const ALGO_VERSION = 'v1';

interface CachedDesignEnvelope {
  cachedAt: string;
  algoVersion: string;
  houseId: string;
  result: DesignResult & { matchedFromCoords?: unknown };
}

export function designCacheKey(houseId: string, profile: CustomerProfile): string {
  const norm = {
    annualConsumptionKwh: profile.annualConsumptionKwh,
    inhabitants: profile.inhabitants,
    houseSizeSqm: profile.houseSizeSqm,
    hasEv: !!profile.hasEv,
    evAnnualKm: profile.evAnnualKm ?? 0,
    heatingType: profile.heatingType,
    isJumelee: !!profile.isJumelee,
  };
  return createHash('sha1')
    .update(`${ALGO_VERSION}|${houseId}|${JSON.stringify(norm)}`)
    .digest('hex')
    .slice(0, 16);
}

export async function readDesignCache(
  houseId: string,
  profile: CustomerProfile,
): Promise<CachedDesignEnvelope | null> {
  const key = designCacheKey(houseId, profile);
  const p = path.join(CACHE_DIR, `${key}.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const env = JSON.parse(raw) as CachedDesignEnvelope;
    if (env.algoVersion !== ALGO_VERSION) return null;
    return env;
  } catch {
    return null;
  }
}

export async function writeDesignCache(
  houseId: string,
  profile: CustomerProfile,
  result: DesignResult & { matchedFromCoords?: unknown },
): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const key = designCacheKey(houseId, profile);
    const env: CachedDesignEnvelope = {
      cachedAt: new Date().toISOString(),
      algoVersion: ALGO_VERSION,
      houseId,
      result,
    };
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(env));
  } catch (err) {
    console.warn('[designCache] write failed:', err);
  }
}
