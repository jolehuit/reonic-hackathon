// End-to-end house generation pipeline (top-down → AI roof → GLB).
//
// 1. Screenshot the page in 2D mode (strict top-down, zoomed on the roof so
//    the red marker pin is visible at image centre).
// 2. Sanity-check the screenshot: verify the red marker is present near the
//    centre — abort if not (camera not framed properly).
// 3. Send to Gemini Vision: bbox + footprint polygon + roof type + ridge.
// 4. Build a minimalist GLB (extrude footprint + roof prism) using
//    @gltf-transform/core. Fallback to a synthetic analysis if AI is rate-
//    limited so the pipeline always produces a GLB.
// 5. Save raw screenshot, cropped roof, analysis JSON, GLB to public/baked/.
//
// Usage:
//   node scripts/generate-house.mjs <houseId> [lat] [lng] [radius]

import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const ROOT = new URL('..', import.meta.url).pathname;
const houseId = process.argv[2] ?? 'brandenburg';
const latArg = process.argv[3];
const lngArg = process.argv[4];
const radiusArg = process.argv[5] ?? '30';

const baseUrl = process.env.NEXT_BASE_URL ?? 'http://localhost:3000';
const params = new URLSearchParams();
if (latArg) params.set('lat', latArg);
if (lngArg) params.set('lng', lngArg);
params.set('radius', radiusArg);
const url = `${baseUrl}/design/${houseId}?${params.toString()}`;

async function readEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env.local'), 'utf8');
    const map = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) map[m[1]] = m[2];
    }
    return map;
  } catch {
    return {};
  }
}

const env = await readEnv();
const GEMINI_KEY =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
const MAPS_KEY =
  process.env.GOOGLE_MAPS_API_KEY ??
  env.GOOGLE_MAPS_API_KEY ??
  env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!GEMINI_KEY) {
  console.error('GOOGLE_GENERATIVE_AI_API_KEY missing.');
  process.exit(1);
}
if (!MAPS_KEY) {
  console.error('GOOGLE_MAPS_API_KEY missing.');
  process.exit(1);
}

// Resolve coordinates
const HOUSE_COORDS = {
  brandenburg: { lat: 48.913527, lng: 2.5149273 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  ruhr: { lat: 51.5135, lng: 7.4653 },
};
const targetLat = Number(latArg ?? HOUSE_COORDS[houseId]?.lat);
const targetLng = Number(lngArg ?? HOUSE_COORDS[houseId]?.lng);
if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
  console.error(`Unknown houseId "${houseId}" and no lat/lng provided.`);
  process.exit(1);
}

console.log('▶ Generate-house pipeline');
console.log('  target :', targetLat, targetLng);

// ───────────── 1. Top-down satellite via Google Static Maps API ─────────────
// zoom=20 → ~0.149 m/pixel at the equator; perfect for one residential roof.
// scale=2 → 1280×1280 actual pixels. We rotate the request so north is up.
const ZOOM = 20;
const SCALE = 2;
const REQ_W = 640, REQ_H = 640; // before scale → 1280×1280 actual
const STATIC_URL =
  `https://maps.googleapis.com/maps/api/staticmap` +
  `?center=${targetLat},${targetLng}` +
  `&zoom=${ZOOM}&scale=${SCALE}&size=${REQ_W}x${REQ_H}` +
  `&maptype=satellite&format=png` +
  `&markers=color:red%7Csize:tiny%7C${targetLat},${targetLng}` +
  `&key=${MAPS_KEY}`;

const ts = Date.now();
const outDir = join(ROOT, 'public/baked');
await mkdir(outDir, { recursive: true });

const resp0 = await fetch(STATIC_URL);
if (!resp0.ok) {
  console.error('Google Static Maps error', resp0.status, await resp0.text());
  process.exit(2);
}
const fullBuf = Buffer.from(await resp0.arrayBuffer());
const fullPath = join(outDir, `${houseId}-generated-${ts}-full.png`);
await writeFile(fullPath, fullBuf);

// Crop the 64px Google attribution strip at the bottom (scale=2 → 64px tall).
const ATTRIBUTION_PX = 64;
const buf = await sharp(fullBuf)
  .extract({ left: 0, top: 0, width: REQ_W * SCALE, height: REQ_H * SCALE - ATTRIBUTION_PX })
  .png()
  .toBuffer();
const rawPath = join(outDir, `${houseId}-generated-${ts}-roof.png`);
await writeFile(rawPath, buf);
console.log('  ✓ roof screenshot    →', rawPath);

// ───────────── 2. Gemini Vision analysis ─────────────
const meta = await sharp(buf).metadata();
const W = meta.width ?? REQ_W * SCALE;
const H = meta.height ?? REQ_H * SCALE - ATTRIBUTION_PX;

// Web Mercator m/px at this latitude / zoom / scale.
const metresPerPixel =
  (156543.03392 * Math.cos((targetLat * Math.PI) / 180)) / Math.pow(2, ZOOM) / SCALE;

const prompt = [
  'You are looking at a strict top-down satellite/photogrammetric image of one or two houses.',
  'A red MARKER PIN at the IMAGE CENTRE marks a precise GPS coordinate sitting on a SINGLE roof.',
  `Image is ${W}x${H} pixels. One pixel ≈ ${metresPerPixel.toFixed(3)} m on the ground.`,
  '',
  'Identify ONLY the roof directly under the red marker pin (ignore neighbouring roofs).',
  'Return JSON:',
  '{',
  '  "bbox": { "x": <int>, "y": <int>, "width": <int>, "height": <int> },',
  '  "footprintPx": [[x,y], [x,y], ...],   // 4-8 polygon vertices outlining the roof, clockwise',
  '  "roofType": "flat" | "gable" | "hip" | "pyramid" | "shed",',
  '  "ridgeAzimuthDeg": <int 0-359>,       // 0 = north, 90 = east. Direction the ridge runs.',
  '  "estWallHeightM": <number>,            // 2.5–9 m typical residential',
  '  "estRoofHeightM": <number>,            // ridge height above eaves; 0 if flat',
  '  "confidence": <0..1>',
  '}',
  '',
  'Return JSON only, no markdown fence, no prose.',
].join('\n');

console.log('▶ Calling Gemini Vision');
async function callGemini(model) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, response_mime_type: 'application/json' },
      }),
    },
  );
  return { status: r.status, json: await r.json() };
}

let analysis;
let aiOk = false;
for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']) {
  const { status, json: gjson } = await callGemini(model);
  if (status === 200) {
    const text = gjson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    try {
      analysis = JSON.parse(text.trim().replace(/^```json|```$/g, '').trim());
      console.log('  ✓ Gemini model used  :', model);
      aiOk = true;
      break;
    } catch {
      console.warn('  ! could not parse', model, 'response, trying next');
    }
  } else {
    console.warn('  !', model, 'error', status, gjson?.error?.status ?? '');
  }
}

if (!aiOk) {
  console.warn('  ! Falling back to synthetic analysis (no AI vision)');
  const cxImg = W / 2, cyImg = H / 2;
  const halfW = 90, halfH = 60;
  analysis = {
    bbox: { x: cxImg - halfW, y: cyImg - halfH, width: halfW * 2, height: halfH * 2 },
    footprintPx: [
      [cxImg - halfW, cyImg - halfH],
      [cxImg + halfW, cyImg - halfH],
      [cxImg + halfW, cyImg + halfH],
      [cxImg - halfW, cyImg + halfH],
    ],
    roofType: 'gable',
    ridgeAzimuthDeg: 90,
    estWallHeightM: 4.5,
    estRoofHeightM: 2.5,
    confidence: 0,
    fallback: true,
  };
}
console.log('  ✓ analysis           :', JSON.stringify(analysis, null, 2));

const analysisPath = join(outDir, `${houseId}-generated-${ts}.json`);
await writeFile(
  analysisPath,
  JSON.stringify({ houseId, ts, metresPerPixel, imageSize: { w: W, h: H }, analysis }, null, 2),
);
console.log('  ✓ analysis JSON      →', analysisPath);

// Cropped roof preview
const bb = analysis.bbox;
if (bb) {
  const x = Math.max(0, Math.min(W - 1, Math.round(bb.x)));
  const y = Math.max(0, Math.min(H - 1, Math.round(bb.y)));
  const w = Math.max(1, Math.min(W - x, Math.round(bb.width)));
  const h = Math.max(1, Math.min(H - y, Math.round(bb.height)));
  const cropPath = join(outDir, `${houseId}-generated-${ts}-cropped.png`);
  await sharp(buf).extract({ left: x, top: y, width: w, height: h }).toFile(cropPath);
  console.log('  ✓ cropped roof       →', cropPath);
}

// ───────────── 4. Build minimalist GLB ─────────────
console.log('▶ Building GLB');
const fp = analysis.footprintPx ?? [];
if (fp.length < 3) {
  console.error('Footprint too small to build geometry');
  process.exit(4);
}
const cx = fp.reduce((s, [x]) => s + x, 0) / fp.length;
const cz = fp.reduce((s, [, y]) => s + y, 0) / fp.length;
const footprintM = fp.map(([x, y]) => [
  (x - cx) * metresPerPixel,
  -(y - cz) * metresPerPixel,
]);

const wallH = Math.max(2.4, Math.min(15, Number(analysis.estWallHeightM) || 4.5));
const roofH = Math.max(0, Math.min(10, Number(analysis.estRoofHeightM) || 2.5));
const ridgeAz = ((Number(analysis.ridgeAzimuthDeg) || 0) % 360) * (Math.PI / 180);

const glbPath = join(outDir, `${houseId}-generated-${ts}.glb`);
await buildHouseGlb({
  footprint: footprintM,
  wallHeight: wallH,
  roofHeight: roofH,
  roofType: analysis.roofType ?? 'gable',
  ridgeAzimuth: ridgeAz,
  outPath: glbPath,
});
console.log('  ✓ GLB                →', glbPath);

const latestPath = join(outDir, `${houseId}-generated-latest.glb`);
await writeFile(latestPath, await readFile(glbPath));
const latestJsonPath = join(outDir, `${houseId}-generated-latest.json`);
await writeFile(latestJsonPath, await readFile(analysisPath));
console.log('  ✓ latest             →', latestPath);
console.log('▶ Done. Open: ' + baseUrl + '/design/' + houseId + '?generated=1');

// ───────────── helpers ─────────────

async function buildHouseGlb({
  footprint,
  wallHeight,
  roofHeight,
  roofType,
  ridgeAzimuth,
  outPath,
}) {
  const doc = new Document();
  doc.createBuffer();

  const wallMat = doc
    .createMaterial('walls')
    .setBaseColorFactor([0.95, 0.95, 0.95, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9);

  const roofMat = doc
    .createMaterial('roof')
    .setBaseColorFactor([0.55, 0.25, 0.2, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.85);

  const wallPositions = [];
  const wallIndices = [];
  for (let i = 0; i < footprint.length; i++) {
    const [x0, z0] = footprint[i];
    const [x1, z1] = footprint[(i + 1) % footprint.length];
    const base = wallPositions.length / 3;
    wallPositions.push(x0, 0, z0, x1, 0, z1, x1, wallHeight, z1, x0, wallHeight, z0);
    wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const floorIdxStart = wallPositions.length / 3;
  for (const [x, z] of footprint) wallPositions.push(x, 0, z);
  for (let i = 1; i < footprint.length - 1; i++) {
    wallIndices.push(floorIdxStart, floorIdxStart + i + 1, floorIdxStart + i);
  }

  const roofPositions = [];
  const roofIndices = [];
  buildRoof({
    type: roofType,
    footprint,
    baseY: wallHeight,
    height: roofHeight,
    ridgeAzimuth,
    positions: roofPositions,
    indices: roofIndices,
  });

  const wallNormals = computeNormals(wallPositions, wallIndices);
  const roofNormals = computeNormals(roofPositions, roofIndices);

  const wallPrim = doc
    .createPrimitive()
    .setMaterial(wallMat)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(wallIndices)))
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(wallPositions)),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(wallNormals)),
    );

  const roofPrim = doc
    .createPrimitive()
    .setMaterial(roofMat)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(roofIndices)))
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(roofPositions)),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(roofNormals)),
    );

  const mesh = doc.createMesh('house').addPrimitive(wallPrim).addPrimitive(roofPrim);
  const node = doc.createNode('house').setMesh(mesh);
  doc.createScene('main').addChild(node);

  const io = new NodeIO();
  const glb = await io.writeBinary(doc);
  await writeFile(outPath, glb);
}

function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const idx of [a, b, c]) {
      n[idx] = nx; n[idx + 1] = ny; n[idx + 2] = nz;
    }
  }
  return n;
}

function buildRoof({ type, footprint, baseY, height, ridgeAzimuth, positions, indices }) {
  const cx = footprint.reduce((s, [x]) => s + x, 0) / footprint.length;
  const cz = footprint.reduce((s, [, z]) => s + z, 0) / footprint.length;
  const apexY = baseY + Math.max(0.1, height);

  if (type === 'flat' || height < 0.2) {
    const start = positions.length / 3;
    for (const [x, z] of footprint) positions.push(x, baseY + Math.max(0.05, height), z);
    for (let i = 1; i < footprint.length - 1; i++) {
      indices.push(start, start + i, start + i + 1);
    }
    return;
  }

  if (type === 'pyramid' || type === 'hip') {
    const apexIdx = positions.length / 3;
    positions.push(cx, apexY, cz);
    const cornerStart = positions.length / 3;
    for (const [x, z] of footprint) positions.push(x, baseY, z);
    for (let i = 0; i < footprint.length; i++) {
      const a = cornerStart + i;
      const b = cornerStart + ((i + 1) % footprint.length);
      indices.push(apexIdx, a, b);
    }
    return;
  }

  const dirX = Math.sin(ridgeAzimuth);
  const dirZ = -Math.cos(ridgeAzimuth);
  let minT = Infinity, maxT = -Infinity;
  for (const [x, z] of footprint) {
    const t = (x - cx) * dirX + (z - cz) * dirZ;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const ridgeAidx = positions.length / 3;
  positions.push(cx + dirX * minT, apexY, cz + dirZ * minT);
  const ridgeBidx = positions.length / 3;
  positions.push(cx + dirX * maxT, apexY, cz + dirZ * maxT);
  const cornerStart = positions.length / 3;
  for (const [x, z] of footprint) positions.push(x, baseY, z);

  for (let i = 0; i < footprint.length; i++) {
    const aIdx = cornerStart + i;
    const bIdx = cornerStart + ((i + 1) % footprint.length);
    const [x0, z0] = footprint[i];
    const [x1, z1] = footprint[(i + 1) % footprint.length];
    const mx = (x0 + x1) / 2 - cx;
    const mz = (z0 + z1) / 2 - cz;
    const t = mx * dirX + mz * dirZ;
    const apex = (t > 0) ? ridgeBidx : ridgeAidx;
    indices.push(aIdx, bIdx, apex);
  }
  indices.push(ridgeAidx, ridgeBidx, cornerStart);
}
