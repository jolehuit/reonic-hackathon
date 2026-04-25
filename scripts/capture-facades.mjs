#!/usr/bin/env node
// Detect → frame → capture → score → clean a building's facades from
// Google Photorealistic 3D Tiles.
//
// Pipeline (all steps optional via CLI flags):
//   1. Geocode address → lat/lng.
//   2. OSM Overpass → exact building footprint (polygon + bbox + heights).
//   3. For each cardinal facade (N, E, S, W):
//        compute facade midpoint + outward normal + dimensions
//        → camera position perpendicular to facade at adapted distance + fov.
//        → load /design/X with explicit camera/target params, screenshot.
//   4. Gemini Vision scores each facade shot (visibility 0–10) and picks the
//      best one.
//   5. Gemini image edit cleans up the best shot (isolate target building,
//      remove neighbors, denoise).
//
// Run:
//   pnpm dev    # in another terminal
//   node scripts/capture-facades.mjs "61 Bd Jean Moulin, 93190 Livry-Gargan, France"
//   # add --no-score and/or --no-clean to skip Gemini steps
//
// Output: public/screen/{1-north,2-east,3-south,4-west}.jpg
//         public/screen/best.jpg          (best raw facade, copy)
//         public/screen/best-clean.jpg    (Gemini-cleaned)
//         public/screen/manifest.json

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUT_DIR = join(PROJECT_ROOT, 'public', 'screen');
const VIEWPORT = { width: 1280, height: 1280 };
const BASE_URL = process.env.TILES_BASE_URL ?? 'http://localhost:3000';
const HOUSE_ID = 'brandenburg';

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OSM_RADIUS_M = 30;

// ─── env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  const content = readFileSync(join(PROJECT_ROOT, '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// ─── 1. geocode ───────────────────────────────────────────────────────────
async function geocode(address, key) {
  const res = await fetch(`${GEOCODE_BASE}?address=${encodeURIComponent(address)}&key=${key}`);
  if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Geocode failed: ${data.status} ${data.error_message ?? ''}`);
  }
  return {
    lat: data.results[0].geometry.location.lat,
    lng: data.results[0].geometry.location.lng,
    formatted: data.results[0].formatted_address,
  };
}

// ─── 2. OSM building footprint ────────────────────────────────────────────
function haversineM(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lng - a.lng);
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function centroidLngLat(points) {
  let sLat = 0;
  let sLng = 0;
  for (const p of points) {
    sLat += p.lat;
    sLng += p.lng;
  }
  return { lat: sLat / points.length, lng: sLng / points.length };
}

async function fetchClosestBuilding(lat, lng) {
  const query = `[out:json];way(around:${OSM_RADIUS_M},${lat},${lng})["building"];out body geom;`;
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: query }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'reonic-hackathon-capture/1.0 (gabriel@example.com)',
      Accept: 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
  const data = await resp.json();
  const candidates = (data.elements ?? []).filter((e) => e.geometry && e.geometry.length >= 3);
  if (!candidates.length) return null;
  const ranked = candidates
    .map((b) => {
      const c = centroidLngLat(b.geometry.map((p) => ({ lat: p.lat, lng: p.lon })));
      return { b, c, dist: haversineM({ lat, lng }, c) };
    })
    .sort((a, b) => a.dist - b.dist);
  const { b, c } = ranked[0];
  const lats = b.geometry.map((p) => p.lat);
  const lngs = b.geometry.map((p) => p.lon);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * cosLat;
  const depthM = (Math.max(...lats) - Math.min(...lats)) * 111320;
  const tags = b.tags ?? {};
  const levels = tags['building:levels'] ? Number(tags['building:levels']) : undefined;
  const heightTag = tags.height ? Number(tags.height) : undefined;
  const heightM = heightTag ?? (levels ? levels * 3 : 8);
  return {
    osmId: b.id,
    polygonLngLat: b.geometry.map((p) => ({ lat: p.lat, lng: p.lon })),
    centroid: c,
    widthM,
    depthM,
    heightM,
    bbox: {
      south: Math.min(...lats),
      north: Math.max(...lats),
      west: Math.min(...lngs),
      east: Math.max(...lngs),
    },
  };
}

// ─── 3. cardinal facades from bbox ────────────────────────────────────────
// For each cardinal direction, pick the facade midpoint on that side of the
// bbox. Camera sits OUTSIDE perpendicular to the facade.
function planFacades(building) {
  const { bbox, centroid, widthM, depthM, heightM } = building;
  // With clipping enabled, only the building footprint is visible — we can
  // afford a wider FOV and farther distance (where Google's tile LOD exists)
  // and still get a tight crop because everything else is masked black.
  const FOV = 35;
  const fovRad = (FOV * Math.PI) / 180;
  const facadeFor = (side) => {
    let target;       // facade midpoint (lat/lng)
    let normalLngLat; // outward unit normal in lat/lng deltas
    let facadeWidth;  // facade real-world width in meters
    if (side === 'north') {
      target = { lat: bbox.north, lng: centroid.lng };
      normalLngLat = { dLat: 1, dLng: 0 };
      facadeWidth = widthM;
    } else if (side === 'south') {
      target = { lat: bbox.south, lng: centroid.lng };
      normalLngLat = { dLat: -1, dLng: 0 };
      facadeWidth = widthM;
    } else if (side === 'east') {
      target = { lat: centroid.lat, lng: bbox.east };
      normalLngLat = { dLat: 0, dLng: 1 };
      facadeWidth = depthM;
    } else { // west
      target = { lat: centroid.lat, lng: bbox.west };
      normalLngLat = { dLat: 0, dLng: -1 };
      facadeWidth = depthM;
    }
    // Distance so that facadeWidth fits ~50% of frame width. Clamp to >= 80m
    // because Google's photogrammetric LOD becomes too coarse below ~60m and
    // returns empty / blocky tiles.
    const distance = Math.max(80, (facadeWidth * 0.5) / Math.tan(fovRad / 2) / 0.5);
    const cosLat = Math.cos((target.lat * Math.PI) / 180);
    const dLatPerM = 1 / 111320;
    const dLngPerM = 1 / (111320 * cosLat);
    const cameraLat = target.lat + normalLngLat.dLat * distance * dLatPerM;
    const cameraLng = target.lng + normalLngLat.dLng * distance * dLngPerM;
    return {
      side,
      target,
      cameraLat,
      cameraLng,
      facadeWidth,
      distance,
      fov: FOV,
    };
  };
  return [facadeFor('north'), facadeFor('east'), facadeFor('south'), facadeFor('west')];
}

// ─── 4. capture each facade via Playwright ───────────────────────────────
function encodeClipPolygon(building) {
  // Browser-equivalent base64 of JSON.
  const polygon = {
    vertices: building.polygonLngLat.map((p) => ({ lat: p.lat, lng: p.lng })),
    topAlt: building.heightM + 2,
    bottomAlt: -1,
  };
  return Buffer.from(JSON.stringify(polygon), 'utf8').toString('base64');
}

async function captureFacades(plans, building, terrainHeightM) {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

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
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[Tiles3DRenderer]') || t.includes('[BuildingClipper]')) {
      console.log('  ' + t);
    }
  });

  const clipParam = encodeClipPolygon(building);

  const results = [];
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    const cameraAlt = terrainHeightM + Math.max(building.heightM * 0.6, 5);
    const targetAlt = terrainHeightM + building.heightM * 0.45;
    const url =
      `${BASE_URL}/design/${HOUSE_ID}?source=tiles&lock=1` +
      `&clat=${p.cameraLat}&clng=${p.cameraLng}&calt=${cameraAlt}` +
      `&tlat=${p.target.lat}&tlng=${p.target.lng}&talt=${targetAlt}` +
      `&fov=${p.fov}` +
      `&clip=${encodeURIComponent(clipParam)}`;
    console.log(`[capture ${i + 1}/4] ${p.side}  dist=${p.distance.toFixed(1)}m  fov=${p.fov}°`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForFunction(() => window.__cameraReady === true, { timeout: 30_000 });
    await page.addStyleTag({
      content: `.pointer-events-none.absolute, [class*="customer-profile"] { display:none !important; }`,
    });
    await page.waitForTimeout(5500);
    const rawFile = `${i + 1}-${p.side}-raw.jpg`;
    const cropFile = `${i + 1}-${p.side}.jpg`;
    const rawPath = join(OUT_DIR, rawFile);
    const cropPath = join(OUT_DIR, cropFile);
    await page.screenshot({ path: rawPath, type: 'jpeg', quality: 92 });
    // Tight crop: find the bounding box of non-near-black pixels and crop the
    // PNG in-page (uses canvas API). The clipper guarantees everything outside
    // the building footprint is the background color (~#0a0a0a).
    const cropBuffer = await page.evaluate(async ({ srcDataUrl, threshold }) => {
      const img = new Image();
      img.src = srcDataUrl;
      await new Promise((r) => (img.onload = r));
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (r > threshold || g > threshold || b > threshold) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX <= minX || maxY <= minY) return null;
      const pad = 24;
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const sw = Math.min(canvas.width - sx, maxX - minX + 2 * pad);
      const sh = Math.min(canvas.height - sy, maxY - minY + 2 * pad);
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      const octx = out.getContext('2d');
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.93));
      const buf = await blob.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    }, {
      srcDataUrl: 'data:image/jpeg;base64,' + readFileSync(rawPath).toString('base64'),
      threshold: 22,
    });
    if (cropBuffer && cropBuffer.length > 0) {
      writeFileSync(cropPath, Buffer.from(cropBuffer));
      console.log(`           ✓ ${cropFile} (cropped to building bounding box)`);
    } else {
      copyFileSync(rawPath, cropPath);
      console.log(`           ⚠ ${cropFile} (no foreground detected — using raw)`);
    }
    results.push({ ...p, file: cropFile, rawFile, outPath: cropPath, cameraAlt, targetAlt });
  }

  await browser.close();
  return results;
}

// ─── 5. Gemini Vision: pick the best facade shot ──────────────────────────
async function scoreFacades(captures, geminiKey) {
  console.log('\n[score] Gemini Vision rating each facade…');
  const fileToB64 = (p) => 'data:image/jpeg;base64,' + readFileSync(p).toString('base64');
  const parts = [
    {
      text:
        `Tu es un expert en photographie d'architecture résidentielle. ` +
        `Voici 4 vues d'une maison sous différents angles depuis Google Photorealistic 3D Tiles. ` +
        `Note chacune de 0 à 10 selon : (1) façade dégagée et centrée, (2) absence d'obstacles ` +
        `(végétation/voitures/voisins), (3) qualité visuelle (netteté, exposition). ` +
        `Réponds STRICTEMENT en JSON: ` +
        `{"scores":[{"index":0,"score":7.5,"reason":"..."}, ...], "best":INDEX}`,
    },
  ];
  for (const c of captures) {
    parts.push({ text: `\nVue ${captures.indexOf(c)} (${c.side}):` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: readFileSync(c.outPath).toString('base64') } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini score HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn('  [score] could not parse Gemini JSON, raw:', text.slice(0, 200));
    return { best: 0, scores: [] };
  }
  for (const s of parsed.scores ?? []) {
    const c = captures[s.index];
    console.log(`  ${s.index} ${c?.side ?? '?'}: ${s.score}/10  — ${s.reason}`);
  }
  console.log(`  best: index ${parsed.best} (${captures[parsed.best]?.side})`);
  void fileToB64;
  return parsed;
}

// ─── 6. Gemini image edit: clean up the best shot ─────────────────────────
async function cleanBestShot(bestPath, outPath, geminiKey) {
  console.log('\n[clean] Gemini image edit on best shot…');
  const b64 = readFileSync(bestPath).toString('base64');
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Edit this Google Photorealistic 3D Tiles screenshot of a residential ` +
              `building. Goals: (1) keep ONLY the central target house — remove or ` +
              `de-emphasize neighboring houses, parked cars, and street clutter. ` +
              `(2) Improve sharpness and clarity of the central facade. ` +
              `(3) Keep realistic colors and lighting. ` +
              `Return only the edited image.`,
          },
          { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        ],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const err = await res.text();
    console.warn(`  [clean] Gemini image HTTP ${res.status}: ${err.slice(0, 200)}`);
    return false;
  }
  const data = await res.json();
  const inline = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!inline) {
    console.warn('  [clean] no image returned by Gemini');
    return false;
  }
  writeFileSync(outPath, Buffer.from(inline.inlineData.data, 'base64'));
  console.log(`  ✓ ${outPath}`);
  return true;
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const skipScore = args.includes('--no-score');
  const skipClean = args.includes('--no-clean');
  const address =
    args.find((a) => !a.startsWith('--')) ?? '61 Bd Jean Moulin, 93190 Livry-Gargan, France';

  const env = loadEnv();
  const mapsKey = env.GOOGLE_MAPS_API_KEY;
  const geminiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!mapsKey) throw new Error('GOOGLE_MAPS_API_KEY missing in .env.local');

  console.log(`\nAddress: ${address}\n`);
  console.log('[1/5] Geocoding…');
  const geo = await geocode(address, mapsKey);
  console.log(`      → ${geo.formatted}`);
  console.log(`      → lat=${geo.lat.toFixed(6)}, lng=${geo.lng.toFixed(6)}`);

  console.log('[2/5] OSM building footprint via Overpass…');
  const building = await fetchClosestBuilding(geo.lat, geo.lng);
  if (!building) throw new Error('No building found within 30m of geocoded point');
  console.log(
    `      → osmId=${building.osmId}  ` +
    `${building.widthM.toFixed(1)}×${building.depthM.toFixed(1)}m  ` +
    `≈${building.heightM}m tall  centroid=(${building.centroid.lat.toFixed(6)}, ${building.centroid.lng.toFixed(6)})`,
  );

  console.log('[3/5] Planning 4 cardinal facades…');
  const plans = planFacades(building);
  for (const p of plans) {
    console.log(
      `      ${p.side.padEnd(5)}  facadeW=${p.facadeWidth.toFixed(1)}m  dist=${p.distance.toFixed(1)}m  fov=${p.fov}°`,
    );
  }

  console.log('\n[4/5] Capturing each facade in Playwright…');
  const TERRAIN_M = 60;
  const captures = await captureFacades(plans, building, TERRAIN_M);

  let scoring = null;
  if (!skipScore) {
    if (!geminiKey) {
      console.warn('GOOGLE_GENERATIVE_AI_API_KEY missing — skipping AI scoring');
    } else {
      scoring = await scoreFacades(captures, geminiKey);
      const best = captures[scoring.best ?? 0];
      copyFileSync(best.outPath, join(OUT_DIR, 'best.jpg'));
      console.log(`  ✓ best copied → public/screen/best.jpg (${best.side})`);
    }
  }

  if (!skipClean && scoring && geminiKey) {
    const best = captures[scoring.best ?? 0];
    await cleanBestShot(best.outPath, join(OUT_DIR, 'best-clean.jpg'), geminiKey);
  }

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        source: 'google-photorealistic-3d-tiles',
        address: geo.formatted,
        geocoded: { lat: geo.lat, lng: geo.lng },
        building: {
          osmId: building.osmId,
          centroid: building.centroid,
          widthM: building.widthM,
          depthM: building.depthM,
          heightM: building.heightM,
          bbox: building.bbox,
        },
        captures: captures.map((c) => ({
          side: c.side,
          file: c.file,
          target: c.target,
          camera: { lat: c.cameraLat, lng: c.cameraLng, alt: c.cameraAlt },
          targetAlt: c.targetAlt,
          fov: c.fov,
          distance: c.distance,
        })),
        scoring,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nDone. Files in: public/screen/\n`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
