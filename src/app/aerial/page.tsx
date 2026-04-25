'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GeneratedHouseViewer } from '@/components/GeneratedHouseViewer';

const DEFAULT_ADDRESS = '61 Bd Jean Moulin, 93190 Livry-Gargan, France';
const DEFAULT_LAT = 48.913527;
const DEFAULT_LNG = 2.5149273;

interface GenResult {
  ok: boolean;
  lat: number;
  lng: number;
  glbUrl?: string;
  analysis?: {
    roofType: string;
    ridgeAzimuthDeg: number;
    estWallHeightM: number;
    estRoofHeightM: number;
    confidence: number;
    fallback?: boolean;
  };
  error?: string;
}

export default function AerialPage() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
  });
  const [topDownUrl, setTopDownUrl] = useState<string>(buildAerialUrl(DEFAULT_LAT, DEFAULT_LNG));
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveCoords(input: string): Promise<{ lat: number; lng: number } | null> {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // Geocode via /api/aerial which already does it server-side and exposes
    // lat/lng in response headers.
    const r = await fetch(`/api/aerial?address=${encodeURIComponent(trimmed)}`, { method: 'HEAD' });
    if (!r.ok) return null;
    const lat = parseFloat(r.headers.get('x-resolved-lat') ?? '');
    const lng = parseFloat(r.headers.get('x-resolved-lng') ?? '');
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGenResult(null);
    const next = await resolveCoords(address);
    if (!next) {
      setError('Could not resolve that address.');
      return;
    }
    setCoords(next);
    setTopDownUrl(buildAerialUrl(next.lat, next.lng));
  }

  async function onGenerate() {
    setError(null);
    setGenerating(true);
    setGenResult(null);
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng, houseId: 'custom' }),
      });
      const json = (await r.json()) as GenResult;
      if (!json.ok) {
        setError(json.error ?? 'Generation failed');
      } else {
        setGenResult(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-white p-6 text-gray-900">
      <h1 className="text-xl font-semibold">Aerial → 3D house</h1>
      <p className="mt-1 text-sm text-gray-500">
        Address or &quot;lat,lng&quot;. Top-down + tilted satellite views; click Generate to run AI roof analysis + GLB.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex w-full max-w-2xl gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address or lat,lng"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          View
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300"
        >
          {generating ? 'Generating…' : 'Generate 3D'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid w-full max-w-6xl gap-4 md:grid-cols-2">
        <Pane title="Top-down (satellite)">
          <img
            src={topDownUrl}
            alt={`Top-down at ${coords.lat}, ${coords.lng}`}
            className="h-full w-full object-cover"
          />
        </Pane>

        <Pane title="3D tilted satellite (interactive)">
          <TiltedMap lat={coords.lat} lng={coords.lng} />
        </Pane>
      </div>

      {genResult?.ok && genResult.glbUrl && (
        <div className="mt-6 w-full max-w-6xl">
          <Pane title="Generated 3D model">
            <div className="relative h-[480px] w-full">
              <GeneratedHouseViewer houseId="custom" />
            </div>
          </Pane>
          {genResult.analysis && (
            <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify(genResult.analysis, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
        {title}
      </div>
      <div className="aspect-square">{children}</div>
    </div>
  );
}

function TiltedMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return;

    const init = () => {
      if (cancelled || !ref.current) return;
      const g = (window as unknown as { google?: { maps?: typeof google.maps } }).google;
      if (!g?.maps) return;
      const map = new g.maps.Map(ref.current, {
        center: { lat, lng },
        zoom: 19,
        tilt: 45,
        heading: 0,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        gestureHandling: 'cooperative',
        rotateControl: true,
      });
      // Drop a small red pin at the target.
      new g.maps.Marker({ position: { lat, lng }, map });
      setReady(true);
    };

    if ((window as unknown as { google?: unknown }).google) {
      init();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-gmaps-tilt]');
    if (existing) {
      existing.addEventListener('load', init);
      return () => {
        cancelled = true;
        existing.removeEventListener('load', init);
      };
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
    s.async = true;
    s.defer = true;
    s.dataset.gmapsTilt = '1';
    s.addEventListener('load', init);
    document.head.appendChild(s);
    return () => {
      cancelled = true;
      s.removeEventListener('load', init);
    };
  }, [lat, lng]);

  return (
    <div className="relative h-full w-full bg-gray-100">
      <div ref={ref} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          Loading 3D map…
        </div>
      )}
    </div>
  );
}

function buildAerialUrl(lat: number, lng: number): string {
  return `/api/aerial?lat=${lat}&lng=${lng}&zoom=20`;
}
