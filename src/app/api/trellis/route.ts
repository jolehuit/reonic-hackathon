// POST /api/trellis — image-to-3D reconstruction via
// fal-ai/hunyuan-3d/v3.1/pro/image-to-3d. Expects a hosted PNG/JPEG URL
// (typically the cleaned-building output of /api/clean-image, hosted on
// fal.media). Route name kept as `/api/trellis` to avoid churning callers
// — only the underlying model changed.
//
// Body: { imageUrl: string }
// Resp: { ok: true, glbUrl, requestId } | { ok: false, error }

import { NextResponse, type NextRequest } from 'next/server';
import { generateTrellisGlb } from '@/lib/fal';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { imageUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const imageUrl = body.imageUrl;
  if (!imageUrl || typeof imageUrl !== 'string') {
    return NextResponse.json({ ok: false, error: 'imageUrl required' }, { status: 400 });
  }

  try {
    const { glbUrl, requestId } = await generateTrellisGlb(imageUrl);
    return NextResponse.json({ ok: true, glbUrl, requestId });
  } catch (err) {
    console.error('[/api/trellis] hunyuan-3d failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'hunyuan-3d failed' },
      { status: 502 },
    );
  }
}
