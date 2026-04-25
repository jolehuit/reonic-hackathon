// Server-side house generator. Fetches a top-down satellite tile from
// Google Static Maps, asks Gemini Vision for a roof analysis, and builds
// a minimalist GLB (extruded footprint + roof prism).
//
// Mirrors the CLI script `scripts/generate-house.mjs` but is callable
// from a Next.js Route Handler.

import { Document, NodeIO } from '@gltf-transform/core';

export interface RoofAnalysis {
  bbox: { x: number; y: number; width: number; height: number };
  footprintPx: Array<[number, number]>;
  roofType: 'flat' | 'gable' | 'hip' | 'pyramid' | 'shed';
  ridgeAzimuthDeg: number;
  estWallHeightM: number;
  estRoofHeightM: number;
  confidence: number;
  fallback?: boolean;
}

export interface GenerateResult {
  glb: Uint8Array;
  raw: Uint8Array;          // top-down screenshot used as primary input
  tilted?: Uint8Array;      // optional 3D tilted screenshot (Mapbox)
  isolated: Uint8Array;     // top-down with everything except the house masked white
  analysis: RoofAnalysis;
  imageSize: { w: number; h: number };
  metresPerPixel: number;
  zoom: number;
}

interface GenerateInput {
  lat: number;
  lng: number;
  zoom?: number; // 17-21
  /** When true, screenshot a 3D tilted satellite view via Playwright instead
   *  of using the flat top-down Static Maps tile. */
  tilted?: boolean;
  /** Public origin used by the headless browser to reach this Next app. */
  origin?: string;
}

const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const REQ_W = 640;
const REQ_H = 640;
const SCALE = 2;
const ATTRIBUTION_PX = 64;

export async function generateHouse(input: GenerateInput): Promise<GenerateResult> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!mapsKey) throw new Error('GOOGLE_MAPS_API_KEY missing');
  if (!geminiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY missing');

  const zoom = clamp(input.zoom ?? 20, 17, 21);
  const sharp = (await import('sharp')).default;
  let cropped: Buffer;
  let W: number;
  let H: number;

  // ── Top-down satellite (always — it's the polygon source of truth) ──
  const topDownUrl =
    `${STATIC_URL}?center=${input.lat},${input.lng}` +
    `&zoom=${zoom}&scale=${SCALE}&size=${REQ_W}x${REQ_H}` +
    `&maptype=satellite&format=png` +
    `&markers=color:red%7Csize:tiny%7C${input.lat},${input.lng}` +
    `&key=${mapsKey}`;
  const topDownRes = await fetch(topDownUrl);
  if (!topDownRes.ok) {
    throw new Error(`Static Maps error ${topDownRes.status}: ${await topDownRes.text()}`);
  }
  W = REQ_W * SCALE;
  H = REQ_H * SCALE - ATTRIBUTION_PX;
  cropped = await sharp(Buffer.from(await topDownRes.arrayBuffer()))
    .extract({ left: 0, top: 0, width: W, height: H })
    .png()
    .toBuffer();

  // ── Optional 3D tilted view via Cesium + Google Photorealistic 3D Tiles ──
  // Rendered headlessly by Playwright on /oblique. Cesium's WebGL context is
  // created with preserveDrawingBuffer:true so the screenshot captures.
  let tiltedBuf: Buffer | null = null;
  if (input.tilted) {
    const origin = input.origin ?? 'http://localhost:3000';
    const obliqueUrl =
      `${origin}/oblique?lat=${input.lat}&lng=${input.lng}` +
      `&zoom=${zoom}&heading=0&tilt=60`;
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 1280 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.goto(obliqueUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page
        .waitForFunction(
          () => ((window as unknown as { __obliqueStable?: number }).__obliqueStable ?? 0) > 25,
          null,
          { timeout: 60_000, polling: 250 },
        )
        .catch(() => {});
      await page.waitForTimeout(800);
      await page
        .evaluate(() => {
          for (const el of document.querySelectorAll('nextjs-portal, [data-nextjs-toast]')) {
            (el as HTMLElement).style.display = 'none';
          }
        })
        .catch(() => {});
      tiltedBuf = await page.screenshot({ fullPage: false });
      await browser.close();
    } catch (err) {
      console.warn('[house-generator] oblique screenshot failed:', err);
    }
  }

  // ── Gemini Vision analysis ──
  const metresPerPixel =
    (156543.03392 * Math.cos((input.lat * Math.PI) / 180)) / Math.pow(2, zoom) / SCALE;

  const promptLines = [
    'You are given ONE or TWO satellite views of the same building.',
    'Image #1 is a strict TOP-DOWN satellite image, with a red MARKER PIN at the centre on the target roof.',
  ];
  if (tiltedBuf) {
    promptLines.push(
      'Image #2 is a 3D OBLIQUE view (~60° tilt) of the SAME building — use it to read roof slopes, ridges, and heights, then map them back onto the top-down outline.',
    );
  }
  promptLines.push(
    `The TOP-DOWN image is ${W}x${H} pixels. Around the centre, one pixel ≈ ${metresPerPixel.toFixed(3)} m on the ground.`,
    'Identify ONLY the roof directly under the red marker pin (ignore neighbouring roofs).',
    'Return ALL coordinates in TOP-DOWN image pixel space (image #1).',
    'Return JSON:',
    '{',
    '  "bbox": { "x": <int>, "y": <int>, "width": <int>, "height": <int> },',
    '  "footprintPx": [[x,y], [x,y], ...],   // 4-8 polygon vertices outlining the roof, clockwise, hugging the eaves',
    '  "roofType": "flat" | "gable" | "hip" | "pyramid" | "shed",',
    '  "ridgeAzimuthDeg": <int 0-359>,       // 0 = north, 90 = east. Direction the ridge runs.',
    '  "estWallHeightM": <number>,            // 2.5-9 m typical residential',
    '  "estRoofHeightM": <number>,            // ridge height above eaves; 0 if flat',
    '  "confidence": <0..1>',
    '}',
    '',
    'Return JSON only, no markdown fence, no prose.',
  );
  const prompt = promptLines.join('\n');

  const callGemini = async (model: string) => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/png',
                    data: cropped.toString('base64'),
                  },
                },
                ...(tiltedBuf
                  ? [
                      {
                        inline_data: {
                          mime_type: 'image/png',
                          data: tiltedBuf.toString('base64'),
                        },
                      },
                    ]
                  : []),
              ],
            },
          ],
          generationConfig: { temperature: 0.1, response_mime_type: 'application/json' },
        }),
      },
    );
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };

  let analysis: RoofAnalysis | null = null;
  for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']) {
    const { status, json } = await callGemini(model);
    if (status !== 200) continue;
    const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      .candidates;
    const text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    try {
      analysis = JSON.parse(text.trim().replace(/^```json|```$/g, '').trim()) as RoofAnalysis;
      break;
    } catch {
      // try next model
    }
  }

  if (!analysis || !Array.isArray(analysis.footprintPx) || analysis.footprintPx.length < 3) {
    // Synthetic fallback so the pipeline still emits a GLB (rate-limited or
    // an empty/garbage AI response).
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

  // ── Build GLB ──
  const fp = analysis.footprintPx ?? [];
  if (fp.length < 3) throw new Error('Footprint too small to build geometry');

  const cx = fp.reduce((s, [x]) => s + x, 0) / fp.length;
  const cz = fp.reduce((s, [, y]) => s + y, 0) / fp.length;
  const footprintM: Array<[number, number]> = fp.map(([x, y]) => [
    (x - cx) * metresPerPixel,
    -(y - cz) * metresPerPixel,
  ]);

  const wallH = clamp(Number(analysis.estWallHeightM) || 4.5, 2.4, 15);
  const roofH = clamp(Number(analysis.estRoofHeightM) || 2.5, 0, 10);
  const ridgeAz = (((Number(analysis.ridgeAzimuthDeg) || 0) % 360) * Math.PI) / 180;

  const glb = await buildHouseGlb({
    footprint: footprintM,
    wallHeight: wallH,
    roofHeight: roofH,
    roofType: analysis.roofType ?? 'gable',
    ridgeAzimuth: ridgeAz,
  });

  // ── Isolated image: only the building polygon, everything else white ──
  const isolated = await maskOutsidePolygon(cropped, W, H, fp);

  return {
    glb,
    raw: cropped,
    tilted: tiltedBuf ?? undefined,
    isolated,
    analysis,
    imageSize: { w: W, h: H },
    metresPerPixel,
    zoom,
  };
}

async function maskOutsidePolygon(
  imageBuf: Buffer,
  w: number,
  h: number,
  polygon: Array<[number, number]>,
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const points = polygon.map(([x, y]) => `${x},${y}`).join(' ');

  // SVG with TRANSPARENT background and an opaque white polygon. When this
  // PNG is composited with blend:'dest-in', only the satellite pixels under
  // the polygon survive — everything else becomes transparent.
  const polygonPng = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<polygon points="${points}" fill="white"/>` +
        `</svg>`,
    ),
  )
    .resize(w, h)
    .png()
    .toBuffer();

  const onlyHouse = await sharp(imageBuf)
    .ensureAlpha()
    .composite([{ input: polygonPng, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Flatten onto white so the saved PNG is opaque white outside the polygon.
  return await sharp(onlyHouse)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

// ── helpers ──

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

interface BuildHouseInput {
  footprint: Array<[number, number]>;
  wallHeight: number;
  roofHeight: number;
  roofType: RoofAnalysis['roofType'];
  ridgeAzimuth: number;
}

async function buildHouseGlb(input: BuildHouseInput): Promise<Uint8Array> {
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

  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  for (let i = 0; i < input.footprint.length; i++) {
    const [x0, z0] = input.footprint[i];
    const [x1, z1] = input.footprint[(i + 1) % input.footprint.length];
    const base = wallPositions.length / 3;
    wallPositions.push(x0, 0, z0, x1, 0, z1, x1, input.wallHeight, z1, x0, input.wallHeight, z0);
    wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const floorIdx = wallPositions.length / 3;
  for (const [x, z] of input.footprint) wallPositions.push(x, 0, z);
  for (let i = 1; i < input.footprint.length - 1; i++) {
    wallIndices.push(floorIdx, floorIdx + i + 1, floorIdx + i);
  }

  const roofPositions: number[] = [];
  const roofIndices: number[] = [];
  buildRoof({
    type: input.roofType,
    footprint: input.footprint,
    baseY: input.wallHeight,
    height: input.roofHeight,
    ridgeAzimuth: input.ridgeAzimuth,
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

  return await new NodeIO().writeBinary(doc);
}

function computeNormals(positions: number[], indices: number[]): Float32Array {
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

interface RoofGenInput {
  type: RoofAnalysis['roofType'];
  footprint: Array<[number, number]>;
  baseY: number;
  height: number;
  ridgeAzimuth: number;
  positions: number[];
  indices: number[];
}

function buildRoof(g: RoofGenInput): void {
  const cx = g.footprint.reduce((s, [x]) => s + x, 0) / g.footprint.length;
  const cz = g.footprint.reduce((s, [, z]) => s + z, 0) / g.footprint.length;
  const apexY = g.baseY + Math.max(0.1, g.height);

  if (g.type === 'flat' || g.height < 0.2) {
    const start = g.positions.length / 3;
    for (const [x, z] of g.footprint) g.positions.push(x, g.baseY + Math.max(0.05, g.height), z);
    for (let i = 1; i < g.footprint.length - 1; i++) {
      g.indices.push(start, start + i, start + i + 1);
    }
    return;
  }

  if (g.type === 'pyramid' || g.type === 'hip') {
    const apexIdx = g.positions.length / 3;
    g.positions.push(cx, apexY, cz);
    const cornerStart = g.positions.length / 3;
    for (const [x, z] of g.footprint) g.positions.push(x, g.baseY, z);
    for (let i = 0; i < g.footprint.length; i++) {
      const a = cornerStart + i;
      const b = cornerStart + ((i + 1) % g.footprint.length);
      g.indices.push(apexIdx, a, b);
    }
    return;
  }

  // gable / shed: ridge along ridgeAzimuth.
  const dirX = Math.sin(g.ridgeAzimuth);
  const dirZ = -Math.cos(g.ridgeAzimuth);
  let minT = Infinity, maxT = -Infinity;
  for (const [x, z] of g.footprint) {
    const t = (x - cx) * dirX + (z - cz) * dirZ;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const ridgeAidx = g.positions.length / 3;
  g.positions.push(cx + dirX * minT, apexY, cz + dirZ * minT);
  const ridgeBidx = g.positions.length / 3;
  g.positions.push(cx + dirX * maxT, apexY, cz + dirZ * maxT);
  const cornerStart = g.positions.length / 3;
  for (const [x, z] of g.footprint) g.positions.push(x, g.baseY, z);
  for (let i = 0; i < g.footprint.length; i++) {
    const a = cornerStart + i;
    const b = cornerStart + ((i + 1) % g.footprint.length);
    const [x0, z0] = g.footprint[i];
    const [x1, z1] = g.footprint[(i + 1) % g.footprint.length];
    const mx = (x0 + x1) / 2 - cx;
    const mz = (z0 + z1) / 2 - cz;
    const t = mx * dirX + mz * dirZ;
    g.indices.push(a, b, t > 0 ? ridgeBidx : ridgeAidx);
  }
  g.indices.push(ridgeAidx, ridgeBidx, cornerStart);
}
