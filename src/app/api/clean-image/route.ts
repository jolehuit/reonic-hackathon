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
