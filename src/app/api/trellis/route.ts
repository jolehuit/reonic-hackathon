// POST /api/trellis — image-to-3D reconstruction via
// fal-ai/hunyuan-3d/v3.1/pro/image-to-3d. Expects a hosted PNG/JPEG URL
// (typically the cleaned-building output of /api/clean-image, hosted on
// fal.media). Route name kept as `/api/trellis` to avoid churning callers
// — only the underlying model changed.
//
// Body: { imageUrl: string, lat?: number, lng?: number }
// Resp: { ok: true, glbUrl, requestId } | { ok: false, error }
//
// If lat + lng are provided, we cache the resulting GLB on disk under
// public/cache/houses/live-{key}/model.glb so the next visit to the same
// address skips Hunyuan entirely (otherwise that's ~60 s + paid quota
// every time).

import { NextResponse, type NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateTrellisGlb } from '@/lib/fal';
import { liveCacheKey } from '@/lib/cacheKey';

export const runtime = 'nodejs';
export const maxDuration = 300;

const HOUSE_CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'houses');

export async function POST(req: NextRequest) {
  let body: { imageUrl?: string; lat?: number; lng?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const imageUrl = body.imageUrl;
  if (!imageUrl || typeof imageUrl !== 'string') {
    return NextResponse.json({ ok: false, error: 'imageUrl required' }, { status: 400 });
  }

  // Optional address-based cache. When the caller (Orchestrator for
  // custom addresses) passes lat/lng, we look for an already-baked GLB
  // before hitting Hunyuan.
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const cacheKey = hasCoords ? liveCacheKey(lat, lng) : null;
  const glbFile = cacheKey ? path.join(HOUSE_CACHE_DIR, cacheKey, 'model.glb') : null;

  if (glbFile) {
    try {
      await fs.access(glbFile);
      return NextResponse.json({
        ok: true,
        glbUrl: `/cache/houses/${cacheKey}/model.glb`,
        cached: true,
      });
    } catch {
      // miss — proceed to generate and save below
    }
  }

  try {
    const { glbUrl: falGlbUrl, requestId } = await generateTrellisGlb(imageUrl);

    // Persist if we have coords. Failure here is non-fatal — return the
    // fal URL so the scene can still load this session.
    if (glbFile && cacheKey) {
      try {
        const r = await fetch(falGlbUrl);
        if (r.ok) {
          const glbBuf = Buffer.from(await r.arrayBuffer());
          await fs.mkdir(path.dirname(glbFile), { recursive: true });
          await fs.writeFile(glbFile, glbBuf);
          return NextResponse.json({
            ok: true,
            glbUrl: `/cache/houses/${cacheKey}/model.glb`,
            requestId,
            cached: false,
          });
        }
      } catch (err) {
        console.warn('[/api/trellis] cache write failed, returning fal URL:', err);
      }
    }
    return NextResponse.json({ ok: true, glbUrl: falGlbUrl, requestId });
  } catch (err) {
    console.error('[/api/trellis] hunyuan-3d failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'hunyuan-3d failed' },
      { status: 502 },
    );
  }
}
