// POST /api/generate — runs Gemini roof analysis + builds the GLB.
// Body: { lat, lng, address?, zoom?, houseId? }
// Resp : { ok, glbUrl, analysis, imageSize, metresPerPixel }

import { NextResponse, type NextRequest } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateHouse } from '@/lib/house-generator';

export const runtime = 'nodejs';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export async function POST(req: NextRequest) {
  let body: {
    lat?: number;
    lng?: number;
    address?: string;
    zoom?: number;
    houseId?: string;
    tilted?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let lat = Number(body.lat);
  let lng = Number(body.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!body.address) {
      return NextResponse.json(
        { ok: false, error: 'Provide lat & lng OR address' },
        { status: 400 },
      );
    }
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!mapsKey) {
      return NextResponse.json(
        { ok: false, error: 'GOOGLE_MAPS_API_KEY not configured' },
        { status: 500 },
      );
    }
    const geo = await fetch(
      `${GEOCODE_URL}?address=${encodeURIComponent(body.address)}&key=${mapsKey}`,
    );
    const json = await geo.json();
    if (json.status !== 'OK' || !json.results?.[0]) {
      return NextResponse.json(
        { ok: false, error: 'Address not found', status: json.status },
        { status: 404 },
      );
    }
    lat = json.results[0].geometry.location.lat;
    lng = json.results[0].geometry.location.lng;
  }

  const origin = req.nextUrl.origin;
  let result;
  try {
    result = await generateHouse({
      lat,
      lng,
      zoom: body.zoom,
      tilted: body.tilted ?? true,
      origin,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const houseId = body.houseId ?? 'custom';
  const outDir = join(process.cwd(), 'public/baked');
  await mkdir(outDir, { recursive: true });
  const glbPath = join(outDir, `${houseId}-generated-latest.glb`);
  const jsonPath = join(outDir, `${houseId}-generated-latest.json`);
  const rawPath = join(outDir, `${houseId}-generated-latest-raw.png`);
  const tiltedPath = join(outDir, `${houseId}-generated-latest-tilted.png`);
  const isolatedPath = join(outDir, `${houseId}-generated-latest-isolated.png`);
  await writeFile(glbPath, result.glb);
  await writeFile(rawPath, result.raw);
  await writeFile(isolatedPath, result.isolated);
  if (result.tilted) await writeFile(tiltedPath, result.tilted);
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        houseId,
        lat,
        lng,
        ts: Date.now(),
        zoom: result.zoom,
        metresPerPixel: result.metresPerPixel,
        imageSize: result.imageSize,
        analysis: result.analysis,
      },
      null,
      2,
    ),
  );

  const ts = Date.now();
  return NextResponse.json({
    ok: true,
    lat,
    lng,
    glbUrl: `/baked/${houseId}-generated-latest.glb?ts=${ts}`,
    rawUrl: `/baked/${houseId}-generated-latest-raw.png?ts=${ts}`,
    isolatedUrl: `/baked/${houseId}-generated-latest-isolated.png?ts=${ts}`,
    tiltedUrl: result.tilted ? `/baked/${houseId}-generated-latest-tilted.png?ts=${ts}` : null,
    analysis: result.analysis,
    imageSize: result.imageSize,
    metresPerPixel: result.metresPerPixel,
  });
}
