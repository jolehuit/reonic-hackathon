// Programmatic scene inspection — measures the GLB's rendered metric size,
// the roof surface area exposed in the scene, and the panel size, so we can
// confirm panels are rendered at real-world scale relative to the roof.
//
// Usage: node scripts/inspect-scale.mjs <house> [outDir]
// Example: node scripts/inspect-scale.mjs brandenburg /tmp

import { chromium } from 'playwright';

const HOUSE = process.argv[2] || 'brandenburg';
const OUT = process.argv[3] || '/tmp';
const URL = `http://localhost:3000/design/${HOUSE}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[err] ${e.message}`));

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

// Run autofill + click generate
await page.waitForTimeout(4500);
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find((x) => /generate design/i.test(x.textContent || ''));
  if (b) b.click();
});

// Poll for stable state
const start = Date.now();
let state = null;
while (Date.now() - start < 90000) {
  await page.waitForTimeout(500);
  state = await page.evaluate(() => {
    const s = window.__store?.getState?.();
    if (!s) return null;
    return {
      phase: s.phase,
      glbStable: s.glbStable,
      placedCount: s.placedCount,
      panelTargetCount: s.panelTargetCount,
    };
  });
  if (!state) continue;
  if (state.phase === 'interactive' && state.placedCount > 0) break;
}
console.log(`stable at +${((Date.now() - start) / 1000).toFixed(1)}s`, state);

// Now inspect the THREE scene
const inspection = await page.evaluate(() => {
  const findRoot = () => {
    // Find a Three.js scene by walking the DOM canvas's __r3f
    const canvases = Array.from(document.querySelectorAll('canvas'));
    for (const c of canvases) {
      const root = c.__r3f?.fiber?.scene || c.__threeJsScene;
      if (root) return root;
    }
    // Fallback: look for window-attached
    return null;
  };
  const scene = findRoot();
  if (!scene) {
    return { error: 'scene not found via canvas.__r3f' };
  }

  // GLB stats
  let glbRoot = null;
  scene.traverse((o) => {
    if (!glbRoot && o.userData?.isGlbRoof) glbRoot = o;
  });
  if (!glbRoot) return { error: 'glb root not found' };

  glbRoot.updateMatrixWorld(true);

  // Compute world-space bbox of GLB
  const THREE = window.THREE || {};
  // Use the meshes' bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triangleCount = 0;
  let roofTriCount = 0;
  let roofArea = 0;
  let totalArea = 0;
  const tmp = { x: 0, y: 0, z: 0 };
  glbRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const geom = obj.geometry;
    const idx = geom.index;
    const pos = geom.attributes.position;
    const matrixWorld = obj.matrixWorld;
    const elems = matrixWorld.elements;
    const transform = (vx, vy, vz) => {
      const x = elems[0]*vx + elems[4]*vy + elems[8]*vz + elems[12];
      const y = elems[1]*vx + elems[5]*vy + elems[9]*vz + elems[13];
      const z = elems[2]*vx + elems[6]*vy + elems[10]*vz + elems[14];
      return [x, y, z];
    };
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.array[t*3] : t*3;
      const i1 = idx ? idx.array[t*3+1] : t*3+1;
      const i2 = idx ? idx.array[t*3+2] : t*3+2;
      const [a0, a1, a2] = transform(pos.array[i0*3], pos.array[i0*3+1], pos.array[i0*3+2]);
      const [b0, b1, b2] = transform(pos.array[i1*3], pos.array[i1*3+1], pos.array[i1*3+2]);
      const [c0, c1, c2] = transform(pos.array[i2*3], pos.array[i2*3+1], pos.array[i2*3+2]);
      // bbox update
      for (const [x, y, z] of [[a0,a1,a2],[b0,b1,b2],[c0,c1,c2]]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      // triangle area + normal
      const ux = b0-a0, uy = b1-a1, uz = b2-a2;
      const vx = c0-a0, vy = c1-a1, vz = c2-a2;
      const nx = uy*vz - uz*vy;
      const ny = uz*vx - ux*vz;
      const nz = ux*vy - uy*vx;
      const len = Math.hypot(nx, ny, nz);
      const area = len * 0.5;
      totalArea += area;
      // Roof triangle: normal Y component / |normal| > 0.5 (mostly upward)
      if (len > 1e-9 && (ny / len) > 0.5) {
        roofArea += area;
        roofTriCount++;
      }
      triangleCount++;
    }
  });

  const glbBbox = {
    minX, minY, minZ, maxX, maxY, maxZ,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  };

  return {
    glbBbox,
    triangleCount,
    roofTriCount,
    totalArea,
    roofArea,
  };
});

console.log('\n=== GLB INSPECTION ===');
console.log(JSON.stringify(inspection, null, 2));

// Real panel size constants (we know these from the code)
const PANEL_AREA_FULL = 1.722 * 1.134;  // 1.953 m²
const PANEL_AREA_COMPACT = 1.10 * 0.70; // 0.77 m²
const PANEL_AREA_MINI = 0.78 * 0.55;    // 0.43 m²

console.log('\n=== SCALE ANALYSIS ===');
if (inspection.error) {
  console.log('ERROR:', inspection.error);
} else {
  const roofArea = inspection.roofArea;
  console.log(`GLB rendered size: ${inspection.glbBbox.width.toFixed(2)} m × ${inspection.glbBbox.height.toFixed(2)} m (h) × ${inspection.glbBbox.depth.toFixed(2)} m`);
  console.log(`Total mesh area: ${inspection.totalArea.toFixed(1)} m²`);
  console.log(`Roof-like area (normal Y > 0.5): ${roofArea.toFixed(1)} m²`);
  console.log(`Triangles: ${inspection.triangleCount} (roof: ${inspection.roofTriCount})`);
  console.log('');
  console.log(`At real panel size:`);
  console.log(`  Full AIKO 475W (1.95 m²): max ${Math.floor(roofArea / PANEL_AREA_FULL)} panels would fit raw, ~${Math.floor(roofArea * 0.5 / PANEL_AREA_FULL)} after south-only + 50% packing`);
  console.log(`  Compact 220W (0.77 m²): max ${Math.floor(roofArea / PANEL_AREA_COMPACT)} panels`);
  console.log('');
  console.log(`Placed: ${state?.placedCount} / ${state?.panelTargetCount}`);
}

// Top-down screenshot for visual sanity
await page.screenshot({ path: `${OUT}/${HOUSE}-side.png`, fullPage: false });

// Try to take a top-down via OrbitControls reset (camera up)
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  const r3f = canvas.__r3f?.fiber || canvas.__r3f;
  if (!r3f) return;
  // Move camera straight above
  const cam = r3f.scene?.children?.find?.((o) => o.isCamera) || r3f.camera;
  if (cam) {
    cam.position.set(0, 30, 0.01);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix?.();
  }
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/${HOUSE}-top.png`, fullPage: false });

console.log(`\nScreenshots: ${OUT}/${HOUSE}-side.png + ${OUT}/${HOUSE}-top.png`);
console.log('\nLast 8 console logs:');
for (const l of logs.slice(-8)) console.log(' ', l);

await browser.close();
