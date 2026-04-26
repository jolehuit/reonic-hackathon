// Iteration helper — opens /design/<house>, clicks through autofill, waits
// for the cached pipeline + GLB load + panel drop animation, then captures
// screenshots from a few angles plus the placedCount/modulePositions state.

import { chromium } from 'playwright';

const HOUSE = process.argv[2] || 'brandenburg';
const OUT_DIR = process.argv[3] || '/tmp';

const URL = `http://localhost:3000/design/${HOUSE}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[err] ${e.message}`));

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

// Autofill takes 3s typewriter, then 'ready-to-design'.
console.log('waiting for autofill…');
await page.waitForTimeout(4500);

// Click "Generate design" via text content.
const clicked = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find((b) => /generate design/i.test(b.textContent || ''));
  if (btn) {
    (btn).click();
    return true;
  }
  return false;
});
console.log(`generate clicked: ${clicked}`);

// Cached pipeline: ~1s fake-step delays + GLB load (32 MB → 2-4s on first
// hit) + 1.7s morph + panel drop (≤2.4s). Poll the store until placedCount
// hits the design's expected count or we time out.
console.log('waiting for pipeline + animation…');
const POLL_MS = 500;
const TIMEOUT_MS = 60000;
const start = Date.now();
let lastSnap = null;
while (Date.now() - start < TIMEOUT_MS) {
  await page.waitForTimeout(POLL_MS);
  lastSnap = await page.evaluate(() => {
    const s = window.__store?.getState?.();
    if (!s) return null;
    return {
      phase: s.phase,
      glbLoaded: s.glbLoaded,
      glbStable: s.glbStable,
      glbHeight: s.glbHeight,
      glbBbox: s.glbBboxXZ,
      roofM2: s.glbRoofAreaM2,
      placedCount: s.placedCount,
      target: s.panelTargetCount,
    };
  });
  if (!lastSnap) continue;
  console.log(`  t=${((Date.now() - start) / 1000).toFixed(1)}s phase=${lastSnap.phase} glb=${lastSnap.glbLoaded} h=${lastSnap.glbHeight?.toFixed?.(2) ?? '-'} placed=${lastSnap.placedCount}/${lastSnap.target}`);
  if (lastSnap.phase === 'interactive' || (lastSnap.placedCount > 0 && lastSnap.placedCount === lastSnap.target)) {
    break;
  }
}

// Collect store state.
const state = await page.evaluate(() => {
  const w = window;
  const store = w.__store?.getState?.();
  if (!store) return null;
  return {
    phase: store.phase,
    glbLoaded: store.glbLoaded,
    glbStable: store.glbStable,
    glbHeight: store.glbHeight,
    glbBboxXZ: store.glbBboxXZ,
    glbRoofAreaM2: store.glbRoofAreaM2,
    placedCount: store.placedCount,
    panelTargetCount: store.panelTargetCount,
    designTotalKwp: store.design?.totalKwp ?? null,
  };
});

// Default angle.
await page.screenshot({ path: `${OUT_DIR}/${HOUSE}-default.png`, fullPage: false });
console.log(`saved ${OUT_DIR}/${HOUSE}-default.png`);

// Top-down view: orbit camera by simulating drag if possible. Not available
// without a deeper hook, so we fallback to manipulating the camera through
// the store/Three internals if exposed.
// For now we just take a second shot after a short wait.
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT_DIR}/${HOUSE}-after.png`, fullPage: false });

console.log('\n--- STORE STATE ---');
console.log(JSON.stringify(state, null, 2));

console.log('\n--- LAST CONSOLE LOGS ---');
for (const l of logs.slice(-20)) console.log(l);

await browser.close();
