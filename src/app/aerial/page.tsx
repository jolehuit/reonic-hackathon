'use client';

import { useState, type FormEvent } from 'react';
import { GeneratedHouseViewer } from '@/components/GeneratedHouseViewer';

const DEFAULT_ADDRESS = '61 Bd Jean Moulin, 93190 Livry-Gargan, France';
const DEFAULT_LAT = 48.913527;
const DEFAULT_LNG = 2.5149273;

interface GenResult {
  ok: boolean;
  lat: number;
  lng: number;
  glbUrl?: string;
  rawUrl?: string;
  tiltedUrl?: string | null;
  isolatedUrl?: string;
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
  const [tiltedUrl, setTiltedUrl] = useState<string>(buildAerialUrl(DEFAULT_LAT, DEFAULT_LNG, true));
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
    setTiltedUrl(buildAerialUrl(next.lat, next.lng, true));
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
        <Pane title={`Top-down satellite · ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`}>
          <img
            src={topDownUrl}
            alt={`Top-down at ${coords.lat}, ${coords.lng}`}
            className="h-full w-full object-cover"
          />
        </Pane>
        <Pane title="3D tilted screenshot (Cesium · Google 3D Tiles)">
          <img
            src={tiltedUrl}
            alt={`Tilted at ${coords.lat}, ${coords.lng}`}
            className="h-full w-full object-cover"
          />
        </Pane>
      </div>

      {genResult?.ok && genResult.glbUrl && (
        <>
          {genResult.isolatedUrl && (
            <div className="mt-6 w-full max-w-3xl">
              <Pane title="Detected house (isolated by Gemini 2.5 Pro)">
                <img
                  src={genResult.isolatedUrl}
                  alt="Isolated building"
                  className="h-full w-full object-contain bg-white"
                />
              </Pane>
            </div>
          )}
          <div className="mt-6 grid w-full max-w-6xl gap-4 md:grid-cols-2">
            {genResult.rawUrl && (
              <Pane title="AI input · top-down">
                <img src={genResult.rawUrl} alt="AI input top-down" className="h-full w-full object-cover" />
              </Pane>
            )}
            {genResult.tiltedUrl && (
              <Pane title="AI input · 3D tilted (Cesium)">
                <img src={genResult.tiltedUrl} alt="AI input tilted" className="h-full w-full object-cover" />
              </Pane>
            )}
            <Pane title="Generated 3D model">
              <div className="relative h-full w-full">
                <GeneratedHouseViewer houseId="custom" />
              </div>
            </Pane>
            {genResult.analysis && (
              <pre className="md:col-span-2 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                {JSON.stringify(genResult.analysis, null, 2)}
              </pre>
            )}
          </div>
        </>
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


function buildAerialUrl(lat: number, lng: number, tilted = false): string {
  return `/api/aerial?lat=${lat}&lng=${lng}&zoom=20${tilted ? '&tilted=1' : ''}`;
}
