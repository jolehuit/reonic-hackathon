'use client';

import { useEffect, useState, type FormEvent } from 'react';

const DEFAULT = '61 Bd Jean Moulin, 93190 Livry-Gargan, France';

function buildAerialUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const latLng = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const params = new URLSearchParams();
  if (latLng) {
    params.set('lat', latLng[1]);
    params.set('lng', latLng[2]);
  } else {
    params.set('address', trimmed);
  }
  return `/api/aerial?${params.toString()}`;
}

export default function AerialPage() {
  const [address, setAddress] = useState(DEFAULT);
  const [imgUrl, setImgUrl] = useState<string | null>(() => buildAerialUrl(DEFAULT));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImgUrl(buildAerialUrl(DEFAULT));
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const next = buildAerialUrl(address);
    if (!next) {
      setError('Enter an address or "lat,lng".');
      return;
    }
    setImgUrl(`${next}&t=${Date.now()}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-white p-6 text-gray-900">
      <h1 className="text-xl font-semibold">Top-down satellite view</h1>
      <p className="mt-1 text-sm text-gray-500">
        Enter an address or paste &quot;lat,lng&quot;. The map is centred on that point.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex w-full max-w-xl gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address or lat,lng"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          View
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 w-full max-w-3xl">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt="Aerial top-down satellite view"
            className="w-full rounded-xl border border-gray-200 shadow-sm"
            onError={() => setError('Could not load the satellite tile (check the address).')}
          />
        ) : (
          <p className="text-center text-sm text-gray-400">No view yet.</p>
        )}
      </div>
    </div>
  );
}
