// Pre-bakes the imagery + GLB pipeline output for the 3 demo houses so the
// AI Designer can short-circuit the live API calls during testing.
//
// For each demo house, this script:
//   1. Calls /api/aerial?tilted=1   → saves aerial.png
//   2. Calls /api/clean-image       → downloads the fal-hosted PNG → clean.png
//   3. Calls /api/trellis           → downloads the fal-hosted GLB → model.glb
// Then writes a combined manifest at public/cache/houses/manifest.json that
// the Orchestrator reads to bypass the live pipeline for these addresses.
//
// Run with the dev server up:
//   pnpm bake:houses

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HOUSE_COORDS } from '../components/Scene3D/vision/houseLatLng';
import type { HouseId } from '../lib/types';

const BASE = process.env.BAKE_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = join(process.cwd(), 'public', 'cache', 'houses');

interface HouseCacheEntry {
  aerialUrl: string;
  cleanUrl: string;
  glbUrl: string;
}

async function bake(id: HouseId): Promise<HouseCacheEntry> {
  const { lat, lng } = HOUSE_COORDS[id];
  const dir = join(OUT_DIR, id);
  await mkdir(dir, { recursive: true });

  console.log(`\n[${id}] @ ${lat},${lng}`);

  console.log(`  ↓ aerial…`);
  const t1 = Date.now();
  const aerialRes = await fetch(
    `${BASE}/api/aerial?lat=${lat}&lng=${lng}&zoom=20&tilted=1`,
  );
  if (!aerialRes.ok) throw new Error(`aerial: ${aerialRes.status} ${await aerialRes.text()}`);
  await writeFile(join(dir, 'aerial.png'), Buffer.from(await aerialRes.arrayBuffer()));
  console.log(`    ✓ ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  console.log(`  ↓ clean (gpt-image-2)…`);
  const t2 = Date.now();
  const cleanRes = await fetch(`${BASE}/api/clean-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  });
  const cleanJson = (await cleanRes.json()) as { ok: boolean; imageUrl?: string; error?: string };
  if (!cleanJson.ok || !cleanJson.imageUrl) {
    throw new Error(`clean failed: ${cleanJson.error ?? 'no imageUrl'}`);
  }
  const cleanImgRes = await fetch(cleanJson.imageUrl);
  if (!cleanImgRes.ok) throw new Error(`clean download: ${cleanImgRes.status}`);
  await writeFile(join(dir, 'clean.png'), Buffer.from(await cleanImgRes.arrayBuffer()));
  console.log(`    ✓ ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  console.log(`  ↓ hunyuan-3d (image → GLB)…`);
  const t3 = Date.now();
  const trellisRes = await fetch(`${BASE}/api/trellis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl: cleanJson.imageUrl }),
  });
  const trellisJson = (await trellisRes.json()) as { ok: boolean; glbUrl?: string; error?: string };
  if (!trellisJson.ok || !trellisJson.glbUrl) {
    throw new Error(`hunyuan-3d failed: ${trellisJson.error ?? 'no glbUrl'}`);
  }
  const glbRes = await fetch(trellisJson.glbUrl);
  if (!glbRes.ok) throw new Error(`glb download: ${glbRes.status}`);
  await writeFile(join(dir, 'model.glb'), Buffer.from(await glbRes.arrayBuffer()));
  console.log(`    ✓ ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  return {
    aerialUrl: `/cache/houses/${id}/aerial.png`,
    cleanUrl: `/cache/houses/${id}/clean.png`,
    glbUrl: `/cache/houses/${id}/model.glb`,
  };
}

async function main() {
  const ids = Object.keys(HOUSE_COORDS) as HouseId[];
  console.log(`Baking ${ids.length} demo houses → ${OUT_DIR}`);

  const manifest: Record<string, HouseCacheEntry> = {};
  for (const id of ids) {
    try {
      manifest[id] = await bake(id);
    } catch (err) {
      console.error(`[${id}] FAILED:`, err);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ manifest written. Cached: ${Object.keys(manifest).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
