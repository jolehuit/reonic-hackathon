// POST /api/trellis — image-to-3D house model via fal-ai/trellis-2.
// Body: { lat, lng, zoom?, address? }
// Resp : { ok, glbUrl, requestId } | { ok:false, error }
//
// Pipeline: lat/lng → /api/aerial?tilted=1 (Cesium oblique screenshot) →
// fal.storage.upload → fal-ai/trellis-2 (~30-60s) → GLB url.

import { NextResponse, type NextRequest } from 'next/server';
import { generateTrellisModel } from '@/lib/trellis';

export const runtime = 'nodejs';
// Trellis can take 60s+; 300s gives plenty of headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ ok: false, error: 'FAL_KEY not configured' }, { status: 500 });
  }

  let body: { lat?: number; lng?: number; zoom?: number; address?: string } = {};
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
  const origin = req.nextUrl.origin;
  const aerialUrl = `${origin}/api/aerial?lat=${lat}&lng=${lng}&zoom=${body.zoom ?? 20}&tilted=1`;
  const aerialRes = await fetch(aerialUrl);
  if (!aerialRes.ok) {
    return NextResponse.json(
      { ok: false, error: `aerial screenshot failed (${aerialRes.status})` },
      { status: 502 },
    );
  }
  const buf = Buffer.from(await aerialRes.arrayBuffer());

  // 2. Run trellis-2.
  try {
    const { glbUrl, requestId } = await generateTrellisModel({ image: buf });
    return NextResponse.json({ ok: true, glbUrl, requestId, lat, lng });
  } catch (err) {
    // Log full stack server-side; bubble the message back so the UI badge is
    // useful and the dev terminal shows what fal actually rejected.
    console.error('[/api/trellis] trellis pipeline failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'trellis failed' },
      { status: 502 },
    );
  }
}
