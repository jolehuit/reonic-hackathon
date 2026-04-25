// Vision cache — OWNED by Dev A, server-side only
// Cache key includes the analysis mode so 'gemini' and 'osm-hybrid' don't
// clash on the same address.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoofGeometry } from '@/lib/types';
import type { BuildingDescription } from './buildingTypes';
import type { AnalysisMode } from './sceneVisionAction';

export interface CacheEntry {
  version: 2;
  createdAt: string;
  modelVersion: string;
  input: {
    lat: number;
    lng: number;
    address: string;
    analysisHash: string;
    mode: AnalysisMode;
  };
  captures: string[];
  building: BuildingDescription;
  inferenceMs: number;
}

const CACHE_DIR = join(process.cwd(), 'public', 'vision-cache');
const memCache = new Map<string, CacheEntry>();

export function buildCacheKey(input: {
  lat: number;
  lng: number;
  analysis: RoofGeometry | null;
  mode: AnalysisMode;
}): { key: string; analysisHash: string } {
  const analysisHash = input.analysis
    ? createHash('sha256').update(JSON.stringify(input.analysis)).digest('hex').slice(0, 16)
    : 'none';
  const composite = `${input.lat.toFixed(6)}|${input.lng.toFixed(6)}|${analysisHash}|${input.mode}`;
  const key = createHash('sha256').update(composite).digest('hex').slice(0, 32);
  return { key, analysisHash };
}

export function readCache(key: string): CacheEntry | null {
  const fromMem = memCache.get(key);
  if (fromMem) return fromMem;

  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.version !== 2) return null;
    memCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(key: string, entry: CacheEntry): void {
  memCache.set(key, entry);
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry, null, 2));
  } catch {
    /* memory cache still serves */
  }
}
