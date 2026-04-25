// Top-down satellite tile for a lat/lng or street address.
// Proxies Google Static Maps so the API key stays server-side and the
// browser can simply <img src="/api/aerial?address=..." />.

import { NextResponse, type NextRequest } from 'next/server';

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';

export async function GET(req: NextRequest) {
  if (!MAPS_KEY) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const latParam = parseFloat(searchParams.get('lat') ?? '');
  const lngParam = parseFloat(searchParams.get('lng') ?? '');
  const address = searchParams.get('address');
  const zoom = clamp(parseInt(searchParams.get('zoom') ?? '20', 10), 17, 21);

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

  const staticUrl =
    `${STATIC_URL}?center=${lat},${lng}` +
    `&zoom=${zoom}&scale=2&size=640x640&maptype=satellite&format=png` +
    `&markers=color:red%7Csize:tiny%7C${lat},${lng}` +
    `&key=${MAPS_KEY}`;

  // Stream the image straight back to the client.
  const imgRes = await fetch(staticUrl);
  if (!imgRes.ok) {
    return NextResponse.json(
      { error: 'Static Maps fetch failed', status: imgRes.status },
      { status: 502 },
    );
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300',
      'x-resolved-lat': String(lat),
      'x-resolved-lng': String(lng),
      'x-resolved-address': resolvedAddress,
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : hi;
}
