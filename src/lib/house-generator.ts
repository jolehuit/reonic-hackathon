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

  // ── 3D oblique view via Playwright on /oblique ──
  // The /oblique page renders Google Photorealistic 3D Tiles with the
  // NASA-AMMOS `3d-tiles-renderer` (Three.js). The WebGL context uses
  // preserveDrawingBuffer:true so Playwright can read the canvas.
  let tiltedBuf: Buffer | null = null;
  if (input.tilted) {
    const origin = input.origin ?? 'http://localhost:3000';
    const obliqueUrl =
      `${origin}/oblique?lat=${input.lat}&lng=${input.lng}` +
      `&heading=0&tilt=60&range=110`;
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

  // ── Gemini Vision analysis (TWO steps) ──
  // Step 1: detect the building under the red dot in the 3D OBLIQUE image.
  // Step 2: read roof type / slope / heights from the same oblique image.
  const metresPerPixel =
    (156543.03392 * Math.cos((input.lat * Math.PI) / 180)) / Math.pow(2, zoom) / SCALE;

  let TW = 1280;
  let TH = 1280;
  if (tiltedBuf) {
    const meta = await sharp(tiltedBuf).metadata();
    if (meta.width && meta.height) {
      TW = meta.width;
      TH = meta.height;
    }
    // Overlay a Google-Maps-style teardrop at image centre so the AI has a
    // crisp visual anchor on the building. The Three.js red dot is small;
    // this teardrop is unmistakable for the vision model.
    tiltedBuf = await overlayCenterPin(tiltedBuf, TW, TH);
  }

  const callGemini = async (
    model: string,
    prompt: string,
    images: Buffer[],
  ): Promise<{ status: number; text: string }> => {
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
                ...images.map((b) => ({
                  inline_data: { mime_type: 'image/png', data: b.toString('base64') },
                })),
              ],
            },
          ],
          generationConfig: { temperature: 0.1, response_mime_type: 'application/json' },
        }),
      },
    );
    const json = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { status: r.status, text };
  };

  const tryParse = <T,>(s: string): T | null => {
    try {
      return JSON.parse(s.trim().replace(/^```json|```$/g, '').trim()) as T;
    } catch {
      return null;
    }
  };

  // Most capable model first for the hard step (precise polygon under the pin),
  // then fall back to lighter / older models if rate-limited.
  const MODELS = ['gemini-3-pro', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];

  // ── STEP 1 — building detection on the 3D OBLIQUE image ──
  // The oblique image is a Cesium screenshot of Google Photorealistic 3D
  // Tiles framed tightly on the target. It looks like a true aerial photo
  // (mesh artefacts, slanted facades, cars on the road, trees, gardens,
  // adjacent rooftops). A SMALL solid red disc (~18 px) sits roughly at the
  // image centre, marking the target building.
  // Strong prompt engineering: ROLE → INPUT → REASONING STEPS → RULES →
  // OUTPUT. The polygon must trace the visible silhouette of the WHOLE
  // building (roof + walls as seen in the oblique view), so the resulting
  // mask cleanly cuts that one house out of the image.
  if (!tiltedBuf) {
    throw new Error(
      'Oblique 3D screenshot missing — required for building detection. Re-run with tilted:true.',
    );
  }
  const detectPrompt = [
    'ROLE',
    'You are a senior expert in aerial / photogrammetric building',
    'segmentation. Your job is to outline ONE single building in a 3D',
    'oblique aerial photograph.',
    '',
    'INPUT IMAGE',
    `- A single ${TW}x${TH}px OBLIQUE aerial view (~60° tilt) of a dense`,
    '  suburban / urban street. It is a photogrammetric mesh, so expect:',
    '    * leaning facades (walls visible, not just roofs)',
    '    * blurry / melted edges and mesh artefacts',
    '    * drifting cars, trees, hedges, gardens, fences, power lines',
    '    * neighbouring houses very close to the target',
    '- ONE Google-Maps-style RED TEARDROP PIN (red body, white outline,',
    '  white centre dot, ~30 px tall) is drawn on the image at the centre.',
    '  The PIN TIP (the pointy bottom of the teardrop) is the precise GPS',
    '  anchor — that is the pixel that marks the TARGET BUILDING. The tip',
    '  may sit on the roof, on a wall, or on the pavement immediately next',
    '  to the house. ALWAYS resolve it to the single residential building',
    '  whose roof or facade is directly under (or closest to) the pin tip.',
    '',
    'REASONING STEPS (think silently, do not output them)',
    '1. Locate the red teardrop pin → its TIP (x,y) pixel is `pinPx`.',
    '2. Decide which single building the disc points to. Heuristics:',
    '     * prefer the building whose footprint the disc overlaps or touches',
    '     * if the disc is on a road, pick the closer house on the side the',
    '       disc leans toward',
    '     * NEVER select a car, tree, hedge, pool, garden, or empty plot',
    '     * pick exactly ONE building, not a row of attached houses unless',
    '       they truly share one continuous roof',
    '3. Trace the FULL VISIBLE SILHOUETTE of that building in the oblique',
    '   view — roof edges PLUS the visible portions of the walls down to',
    '   where the building meets the ground. Follow the real outline tightly.',
    '   Do NOT include trees in front of it, the driveway, the garden, or',
    '   neighbouring buildings.',
    '4. Use 6–16 clockwise vertices. Polygon must be simple (non self-',
    '   intersecting) and tight to the building, not a loose bounding shape.',
    '5. Compute the axis-aligned bounding box → `bbox`.',
    '',
    'STRICT RULES',
    '- All coordinates are INTEGERS in oblique-image pixel space.',
    `- Polygon area between 8 000 and ${((TW * TH * 0.5) | 0)} px² (a single`,
    '  house typically takes 5–30% of this tightly framed view).',
    '- Polygon must overlap or be within ~40 px of the pin TIP.',
    '- If you cannot confidently find the pin OR the target building,',
    '  return confidence = 0 with an empty `footprintPx` array. Do NOT guess.',
    '',
    'OUTPUT',
    'Return STRICT JSON only, no prose, no markdown fence:',
    '{',
    '  "pinPx": [<int x>, <int y>],',
    '  "bbox":  { "x": <int>, "y": <int>, "width": <int>, "height": <int> },',
    '  "footprintPx": [[x,y], [x,y], ...],',
    '  "confidence": <number between 0 and 1>',
    '}',
  ].join('\n');

  interface DetectResult {
    bbox: RoofAnalysis['bbox'];
    footprintPx: Array<[number, number]>;
    confidence: number;
  }

  let detect: DetectResult | null = null;
  for (const model of MODELS) {
    const { status, text } = await callGemini(model, detectPrompt, [tiltedBuf]);
    if (status !== 200) continue;
    const parsed = tryParse<DetectResult>(text);
    if (parsed && Array.isArray(parsed.footprintPx) && parsed.footprintPx.length >= 3) {
      detect = parsed;
      break;
    }
  }

  if (!detect) {
    const cxImg = TW / 2, cyImg = TH / 2;
    const halfW = 220, halfH = 200;
    detect = {
      bbox: { x: cxImg - halfW, y: cyImg - halfH, width: halfW * 2, height: halfH * 2 },
      footprintPx: [
        [cxImg - halfW, cyImg - halfH],
        [cxImg + halfW, cyImg - halfH],
        [cxImg + halfW, cyImg + halfH],
        [cxImg - halfW, cyImg + halfH],
      ],
      confidence: 0,
    };
  }

  // ── STEP 2 — roof shape / heights (mostly from the 3D oblique view) ──
  interface ShapeResult {
    roofType: RoofAnalysis['roofType'];
    ridgeAzimuthDeg: number;
    estWallHeightM: number;
    estRoofHeightM: number;
    confidence: number;
  }

  let shape: ShapeResult | null = null;
  {
    const fpStr = detect.footprintPx.map(([x, y]) => `[${Math.round(x)},${Math.round(y)}]`).join(',');
    const shapePrompt = [
      'You are given a 3D OBLIQUE aerial view (~60° tilt) of one building.',
      `Image is ${TW}x${TH} px. The target building has already been outlined`,
      `with this oblique-pixel-space polygon: ${fpStr}.`,
      '',
      'Read the roof slope, ridge orientation and heights from the oblique',
      'view. Express ridge azimuth in real-world compass degrees (0=N, 90=E).',
      '',
      'Return JSON only:',
      '{',
      '  "roofType": "flat" | "gable" | "hip" | "pyramid" | "shed",',
      '  "ridgeAzimuthDeg": <int 0-359>,',
      '  "estWallHeightM": <number>,         // eaves above ground, 2.5-9 typical',
      '  "estRoofHeightM": <number>,         // ridge height ABOVE eaves; 0 if flat',
      '  "confidence": <0..1>',
      '}',
    ].join('\n');

    for (const model of MODELS) {
      const { status, text } = await callGemini(model, shapePrompt, [tiltedBuf]);
      if (status !== 200) continue;
      const parsed = tryParse<ShapeResult>(text);
      if (parsed && typeof parsed.roofType === 'string') {
        shape = parsed;
        break;
      }
    }
  }

  if (!shape) {
    shape = {
      roofType: 'gable',
      ridgeAzimuthDeg: 90,
      estWallHeightM: 4.5,
      estRoofHeightM: 2.5,
      confidence: 0,
    };
  }

  const analysis: RoofAnalysis = {
    bbox: detect.bbox,
    footprintPx: detect.footprintPx,
    roofType: shape.roofType,
    ridgeAzimuthDeg: shape.ridgeAzimuthDeg,
    estWallHeightM: shape.estWallHeightM,
    estRoofHeightM: shape.estRoofHeightM,
    confidence: Math.min(detect.confidence, shape.confidence),
    fallback: detect.confidence === 0 || shape.confidence === 0,
  };

  // ── Build GLB ──
  // Detection now runs on the OBLIQUE image, so polygon vertices are in a
  // perspective-distorted pixel space and CANNOT be used as flat ground
  // metres. Use the bbox extents as a rough rectangular footprint scaled to
  // the building's apparent oblique width (≈ 1.3× the projected metres) —
  // good enough for a placeholder GLB while the AI focus is the isolated
  // image. The CLI script remains the source of truth for accurate GLBs.
  const fp = analysis.footprintPx ?? [];
  const bboxWm = (analysis.bbox.width * metresPerPixel) / 1.3;
  const bboxHm = (analysis.bbox.height * metresPerPixel) / 1.3;
  const halfWm = clamp(bboxWm / 2, 4, 25);
  const halfHm = clamp(bboxHm / 2, 4, 25);
  const footprintM: Array<[number, number]> = [
    [-halfWm, -halfHm],
    [ halfWm, -halfHm],
    [ halfWm,  halfHm],
    [-halfWm,  halfHm],
  ];

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

  // ── Isolated image: mask the OBLIQUE view with the detected polygon ──
  const isolated = await maskOutsidePolygon(tiltedBuf, TW, TH, fp);

  return {
    glb,
    raw: cropped,
    tilted: tiltedBuf,
    isolated,
    analysis,
    imageSize: { w: TW, h: TH },
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

// ── Aerial View API helpers ──

const AERIAL_RENDER = 'https://aerialview.googleapis.com/v1/videos:renderVideo';
const AERIAL_LOOKUP = 'https://aerialview.googleapis.com/v1/videos:lookupVideo';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

interface AerialLookupResponse {
  state?: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  uris?: Record<string, string>;
  metadata?: { videoId?: string };
}

/**
 * Fetch a 3D oblique still frame for the given lat/lng using Google's
 * Aerial View API. First call for an address can take 30-60s while Google
 * renders the fly-around video; subsequent calls are cached and instant.
 */
async function fetchAerialViewStill(
  lat: number,
  lng: number,
  mapsKey: string,
): Promise<Buffer | null> {
  // Aerial View API takes an address, so reverse-geocode lat/lng first.
  const geo = await fetch(`${GEOCODE}?latlng=${lat},${lng}&key=${mapsKey}`);
  const geoJson = (await geo.json()) as {
    status: string;
    results?: Array<{ formatted_address: string }>;
  };
  if (geoJson.status !== 'OK' || !geoJson.results?.[0]) {
    console.warn('[aerial-view] reverse geocode failed:', geoJson.status);
    return null;
  }
  const address = geoJson.results[0].formatted_address;

  // Trigger the render (idempotent — Google caches per address).
  await fetch(`${AERIAL_RENDER}?key=${mapsKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  }).catch(() => {});

  // Poll lookupVideo until ACTIVE (or 90s timeout).
  const deadline = Date.now() + 90_000;
  let lookup: AerialLookupResponse | null = null;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${AERIAL_LOOKUP}?key=${mapsKey}&address=${encodeURIComponent(address)}`,
    );
    lookup = (await r.json()) as AerialLookupResponse;
    if (lookup.state === 'ACTIVE') break;
    if (lookup.state === 'FAILED') {
      console.warn('[aerial-view] render failed for', address);
      return null;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  if (!lookup || lookup.state !== 'ACTIVE') {
    console.warn('[aerial-view] timed out waiting for video');
    return null;
  }

  // Pull the highest-res still image. The API returns several keys —
  // accept whichever IMAGE_* / THUMBNAIL_* one is present.
  const uris = lookup.uris ?? {};
  const imgUrl =
    uris.IMAGE_HIGH ??
    uris.IMAGE_MEDIUM ??
    uris.IMAGE_LOW ??
    uris.THUMBNAIL_HIGH ??
    uris.THUMBNAIL_MEDIUM ??
    uris.THUMBNAIL_LOW;
  if (!imgUrl) {
    console.warn('[aerial-view] no image URI in response keys:', Object.keys(uris));
    return null;
  }
  const ir = await fetch(imgUrl);
  if (!ir.ok) {
    console.warn('[aerial-view] image fetch failed:', ir.status);
    return null;
  }
  return Buffer.from(await ir.arrayBuffer());
}

/** Draw a Google-Maps-style red teardrop pin at the image centre. The pin
 *  TIP sits exactly at (cx, cy) so the AI can reliably anchor on the building
 *  underneath it (matches the maps.google.com convention). */
async function overlayCenterPin(buf: Buffer, w: number, h: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const cx = Math.round(w / 2);
  const tipY = Math.round(h / 2);
  // Pin geometry: ~46px tall teardrop with a 14px head radius and a 4px white
  // outline, identical proportions to Google's standard "place" marker.
  const headR = 14;
  const headCy = tipY - 30; // pin head sits ABOVE the tip
  const path =
    `M ${cx} ${tipY} ` +
    `C ${cx - headR * 1.1} ${tipY - headR * 1.4}, ` +
    `${cx - headR} ${headCy + headR * 0.5}, ` +
    `${cx - headR} ${headCy} ` +
    `A ${headR} ${headR} 0 1 1 ${cx + headR} ${headCy} ` +
    `C ${cx + headR} ${headCy + headR * 0.5}, ` +
    `${cx + headR * 1.1} ${tipY - headR * 1.4}, ` +
    `${cx} ${tipY} Z`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<g filter="url(#shadow)">` +
    `<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.45"/>` +
    `</filter></defs>` +
    `<path d="${path}" fill="#ea4335" stroke="white" stroke-width="3"/>` +
    `<circle cx="${cx}" cy="${headCy}" r="5" fill="white"/>` +
    `</g></svg>`;
  return await sharp(buf)
    .composite([{ input: Buffer.from(svg) }])
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
