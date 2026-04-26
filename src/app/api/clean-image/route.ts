// POST /api/clean-image — runs GPT Image 2 (edit mode) on the oblique
// aerial screenshot, returning a fal-hosted URL of the cleaned image
// (target building only, white background) ready for fal-ai/trellis.
//
// Body: { lat: number, lng: number, zoom?: number }
// Resp: { ok: true, imageUrl } | { ok: false, error }

import { NextResponse, type NextRequest } from 'next/server';
import { cleanBuildingImage } from '@/lib/fal';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { lat?: number; lng?: number; zoom?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: false, error: 'lat & lng required' }, { status: 400 });
  }

  // 1. Pull the oblique screenshot from /api/aerial?tilted=1.
  // Use http://localhost:$PORT instead of req.nextUrl.origin — see the same
  // comment in /api/aerial/route.ts: Cloud Run gives us https://0.0.0.0:8080
  // which the container itself doesn't terminate TLS on, so the loopback
  // fetch fails with SSL_PROTOCOL_ERROR.
  const port = process.env.PORT ?? '3000';
  const origin = `http://localhost:${port}`;
  const zoomParam = Number.isFinite(Number(body.zoom)) ? Number(body.zoom) : 20;
  const aerialUrl = `${origin}/api/aerial?lat=${lat}&lng=${lng}&zoom=${zoomParam}&tilted=1`;
  // _ keeps `req` referenced for clarity; we intentionally don't use
  // req.nextUrl.origin anymore.
  void req;
  // SSRF guard — the URL is constructed from PORT (deploy-controlled) and
  // numeric lat/lng/zoom (validated above), so it's never user-controlled
  // by design. The explicit hostname assertion is a tripwire: if the URL
  // template ever drifts to include a string from the body, the parsed
  // `host` will no longer match `localhost` and the request is refused
  // before fetch() can hit a foreign origin.
  const parsed = new URL(aerialUrl);
  if (parsed.hostname !== 'localhost') {
    return NextResponse.json(
      { ok: false, error: 'invalid aerial URL — not loopback' },
      { status: 500 },
    );
  }
  const aerialRes = await fetch(aerialUrl);
  if (!aerialRes.ok) {
    return NextResponse.json(
      { ok: false, error: `aerial screenshot failed (${aerialRes.status})` },
      { status: 502 },
    );
  }
  const buf = Buffer.from(await aerialRes.arrayBuffer());

  // 2. Run GPT Image 2 to clean / isolate the building.
  try {
    const { imageUrl } = await cleanBuildingImage(buf);
    return NextResponse.json({ ok: true, imageUrl });
  } catch (err) {
    console.error('[/api/clean-image] gpt-image-2 failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'gpt-image-2 failed' },
      { status: 502 },
    );
  }
}
