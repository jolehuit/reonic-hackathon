// Top-down (default) or 3D-tilted (?tilted=1) satellite view for a lat/lng or
// street address. Top-down → Google Static Maps proxy. Tilted → Cesium +
// Google Photorealistic 3D Tiles rendered headlessly via Playwright.
//
// Disk cache: the rendered PNG is written to public/cache/aerial/{key}.png
// keyed on (lat, lng, zoom, tilted). Subsequent requests serve from disk —
// important because the tilted path takes ~10–15s to regenerate.

import { NextResponse, type NextRequest } from 'next/server';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const CACHE_DIR = join(process.cwd(), 'public', 'cache', 'aerial');

function cacheKey(lat: number, lng: number, zoom: number, tilted: boolean): string {
  return `${lat.toFixed(6)}_${lng.toFixed(6)}_z${zoom}_t${tilted ? 1 : 0}.png`;
}

export async function GET(req: NextRequest) {
  if (!MAPS_KEY) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const latParam = parseFloat(searchParams.get('lat') ?? '');
  const lngParam = parseFloat(searchParams.get('lng') ?? '');
  const address = searchParams.get('address');
  const zoom = clamp(parseInt(searchParams.get('zoom') ?? '20', 10), 17, 21);
  const tilted = searchParams.get('tilted') === '1';

  let lat: number;
  let lng: number;
  let resolvedAddress = address ?? '';

  if (Number.isFinite(latParam) && Number.isFinite(lngParam)) {
    lat = latParam;
    lng = lngParam;
  } else if (address) {
    const geo = await fetch(
      `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${MAPS_KEY}`,
    );
    const json = await geo.json();
    if (json.status !== 'OK' || !json.results?.[0]) {
      return NextResponse.json(
        { error: 'Address not found', status: json.status },
        { status: 404 },
      );
    }
    lat = json.results[0].geometry.location.lat;
    lng = json.results[0].geometry.location.lng;
    resolvedAddress = json.results[0].formatted_address;
  } else {
    return NextResponse.json({ error: 'Provide lat & lng OR address' }, { status: 400 });
  }

  // ── Disk cache lookup ───────────────────────────────────────────────────
  const cachePath = join(CACHE_DIR, cacheKey(lat, lng, zoom, tilted));
  if (existsSync(cachePath)) {
    const cached = await readFile(cachePath);
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=300',
        'x-cache': 'HIT',
        'x-resolved-lat': String(lat),
        'x-resolved-lng': String(lng),
        'x-resolved-address': resolvedAddress,
      },
    });
  }

  let buf: Buffer;

  if (tilted) {
    // Render the Cesium oblique page in headless Chromium and screenshot it.
    const origin = req.nextUrl.origin;
    // Look up the local ground elevation (in metres above WGS84 ellipsoid)
    // via Google's Elevation API. This is then forwarded to /oblique so the
    // marker can be placed AT building-roof height — without it, the dot
    // sits at the wrong altitude and the oblique parallax shifts it off the
    // visible roof. The API returns orthometric height (above MSL/EGM2008)
    // so we add the typical European geoid undulation (~45 m) to convert it
    // to ellipsoidal height, then add ~8 m for typical European roof height.
    let elevAboveEllipsoid: number | null = null;
    try {
      const er = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${MAPS_KEY}`,
      );
      const ej = (await er.json()) as { results?: Array<{ elevation?: number }> };
      const orthometric = ej.results?.[0]?.elevation;
      if (typeof orthometric === 'number') {
        // Geoid undulation rough constant for Western/Central Europe.
        // (Precise per-location N would need a geoid model; +45 is fine here.)
        elevAboveEllipsoid = orthometric + 45;
      }
    } catch {
      /* ignore — falls back to default in /oblique */
    }
    const elevParam = elevAboveEllipsoid !== null ? `&elev=${elevAboveEllipsoid}` : '';
    const obliqueUrl =
      `${origin}/oblique?lat=${lat}&lng=${lng}&zoom=${zoom}&heading=0&tilt=40&height=50${elevParam}`;
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
      buf = await page.screenshot({ fullPage: false });
      await browser.close();
    } catch (err) {
      return NextResponse.json(
        { error: 'Oblique render failed', detail: String(err) },
        { status: 502 },
      );
    }
  } else {
    const staticUrl =
      `${STATIC_URL}?center=${lat},${lng}` +
      `&zoom=${zoom}&scale=2&size=640x640&maptype=satellite&format=png` +
      `&markers=color:red%7Csize:tiny%7C${lat},${lng}` +
      `&key=${MAPS_KEY}`;
    const imgRes = await fetch(staticUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: 'Static Maps fetch failed', status: imgRes.status },
        { status: 502 },
      );
    }
    buf = Buffer.from(await imgRes.arrayBuffer());
  }

  // ── Persist to disk cache (best-effort, never blocks the response) ──────
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, buf);
  } catch (err) {
    console.warn('[/api/aerial] failed to write cache:', err);
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300',
      'x-cache': 'MISS',
      'x-resolved-lat': String(lat),
      'x-resolved-lng': String(lng),
      'x-resolved-address': resolvedAddress,
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : hi;
}
