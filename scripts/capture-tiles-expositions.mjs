#!/usr/bin/env node
// Capture 4 cardinal expositions of a building from Google Photorealistic 3D
// Tiles, exactly like clicking the compass quarters in Google Maps 3D.
//
// Pipeline:
//   1. Reuse the running Next dev server (npm run dev).
//   2. Open /design/<houseId>?source=tiles&lock=1&azimuth=<deg>
//   3. Wait for tiles to settle, then call window.__setCameraAzimuth(deg)
//      for each of {180=south, 270=west, 0=north, 90=east}.
//   4. Save 4 JPEGs to public/screen/.
//
// Run:
//   node scripts/capture-tiles-expositions.mjs              # default brandenburg
//   node scripts/capture-tiles-expositions.mjs hamburg

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUT_DIR = join(PROJECT_ROOT, 'public', 'screen');
const VIEWPORT = { width: 1280, height: 1280 };
const BASE_URL = process.env.TILES_BASE_URL ?? 'http://localhost:3000';

const EXPOSITIONS = [
  { file: '1-sud.jpg',   label: 'exposition Sud  (camera south, looking north)', azimuth: 0   },
  { file: '2-ouest.jpg', label: 'exposition Ouest (camera west, looking east)',  azimuth: 90  },
  { file: '3-nord.jpg',  label: 'exposition Nord (camera north, looking south)', azimuth: 180 },
  { file: '4-est.jpg',   label: 'exposition Est  (camera east, looking west)',   azimuth: 270 },
];

async function main() {
  const houseId = process.argv[2] ?? 'brandenburg';
  const startUrl = `${BASE_URL}/design/${houseId}?source=tiles&lock=1&azimuth=${EXPOSITIONS[0].azimuth}`;

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\nHouse: ${houseId}`);
  console.log(`URL:   ${startUrl}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--window-position=-2400,-2400',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--ignore-gpu-blocklist',
    ],
  });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  let tileReqs = 0;
  page.on('request', (r) => { if (r.url().includes('tile.googleapis')) tileReqs++; });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[Tiles3DRenderer]')) console.log('  ' + t);
  });

  console.log('[1/3] Loading scene…');
  await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__cameraReady === true,
    { timeout: 30_000 },
  );
  console.log(`      → camera ready, tile requests so far: ${tileReqs}`);

  console.log('[2/3] Hiding overlay UI for clean shots…');
  await page.addStyleTag({
    content: `
      [class*="Customer profile"], [class*="customer-profile"],
      .pointer-events-none.absolute { display: none !important; }
    `,
  });

  console.log('[3/3] Capturing 4 expositions…');
  const captures = [];
  for (const exp of EXPOSITIONS) {
    await page.evaluate((deg) => {
      if (typeof window.__setCameraAzimuth === 'function') {
        window.__setCameraAzimuth(deg);
      }
    }, exp.azimuth);
    // Let the new viewpoint stream in fresh tiles before snapping.
    await page.waitForTimeout(4500);
    const outPath = join(OUT_DIR, exp.file);
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 92, fullPage: false });
    console.log(`      ✓ ${exp.file}  — ${exp.label}`);
    captures.push({ ...exp });
  }

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        source: 'google-photorealistic-3d-tiles',
        houseId,
        baseUrl: BASE_URL,
        viewport: VIEWPORT,
        captures,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nDone — ${tileReqs} total tile requests. Files in: public/screen/`);
  for (const e of EXPOSITIONS) console.log(`  - ${e.file}`);
  console.log(`  - manifest.json\n`);

  await browser.close();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
