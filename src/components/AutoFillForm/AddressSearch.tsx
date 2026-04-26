'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useStore, type CustomAddress } from '@/lib/store';
import { parseCoordinateString } from '@/lib/coords';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Modern Places API (post-March 2025): PlaceAutocompleteElement web component.
// The legacy `Autocomplete` constructor is blocked for new keys.
interface LatLng {
  lat: () => number;
  lng: () => number;
}
interface FetchedPlace {
  formattedAddress?: string | null;
  location?: LatLng | null;
  id?: string | null;
  addressComponents?: Array<{ shortText?: string | null; types?: string[] | null }> | null;
}
interface PlacePrediction {
  toPlace: () => {
    fetchFields: (req: { fields: string[] }) => Promise<{ place?: FetchedPlace }>;
  };
}
interface GmpSelectEvent extends Event {
  placePrediction?: PlacePrediction;
}
type PlaceAutocompleteCtor = new (opts?: Record<string, unknown>) => HTMLElement;
interface ImportedPlacesLib {
  PlaceAutocompleteElement?: PlaceAutocompleteCtor;
}
interface GoogleMaps {
  maps: {
    importLibrary?: (name: string) => Promise<ImportedPlacesLib>;
  };
}
declare global {
  interface Window {
    google?: GoogleMaps;
    __reonicGoogleMapsLoading?: Promise<void>;
  }
}

// Official Google bootstrap (https://developers.google.com/maps/documentation/javascript/load-maps-js-api).
// Installs `window.google.maps.importLibrary` synchronously, then injects the
// real API script on first import call.
function installGoogleBootstrap(apiKey: string) {
  if (typeof window === 'undefined') return;
  if (window.google?.maps?.importLibrary) return;

  type GMapsRoot = { maps?: Record<string, unknown> };
  const w = window as unknown as { google?: GMapsRoot };
  const g = (w.google = w.google || {}) as GMapsRoot;
  const d = (g.maps = g.maps || {}) as Record<string, unknown>;
  if (d.importLibrary) return;

  const params: Record<string, string> = { key: apiKey, v: 'weekly' };
  const libs = new Set<string>();
  let pending: Promise<void> | undefined;

  const startLoad = (): Promise<void> =>
    pending ||
    (pending = new Promise<void>((resolve, reject) => {
      const e = new URLSearchParams();
      e.set('libraries', [...libs].join(','));
      for (const k of Object.keys(params)) {
        e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), params[k]);
      }
      e.set('callback', 'google.maps.__ib__');
      const a = document.createElement('script');
      a.src = `https://maps.googleapis.com/maps/api/js?${e.toString()}`;
      (d as { __ib__?: () => void }).__ib__ = () => resolve();
      a.onerror = () => reject(new Error('Google Maps could not load.'));
      a.async = true;
      document.head.append(a);
    }));

  d.importLibrary = (name: string) => {
    libs.add(name);
    return startLoad().then(() => {
      const il = (d.importLibrary as unknown) as (n: string) => Promise<unknown>;
      // Replaced by the real importLibrary once the API loads.
      return il(name);
    });
  };
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.__reonicGoogleMapsLoading) return window.__reonicGoogleMapsLoading;
  installGoogleBootstrap(apiKey);
  window.__reonicGoogleMapsLoading = Promise.resolve();
  return window.__reonicGoogleMapsLoading;
}

export function AddressSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const setCustomAddress = useStore((s) => s.setCustomAddress);
  const selectHouse = useStore((s) => s.selectHouse);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    API_KEY
      ? null
      : 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing — set it in .env.local to enable autocomplete.',
  );
  const [picked, setPicked] = useState<CustomAddress | null>(null);

  // Coordinate-paste fallback. Google Places Autocomplete only matches
  // street addresses / POI names — pasting raw GPS coordinates (DMS or
  // decimal) returned no suggestions and the "Design my system" button
  // stayed disabled. This separate input parses the coords client-side
  // and reverse-geocodes them server-side via /api/aerial to recover a
  // friendly address string for display.
  const [coordsInput, setCoordsInput] = useState('');
  const [coordsBusy, setCoordsBusy] = useState(false);
  const [coordsError, setCoordsError] = useState<string | null>(null);

  const handleCoordsSubmit = async () => {
    setCoordsError(null);
    const parsed = parseCoordinateString(coordsInput);
    if (!parsed) {
      setCoordsError(
        'Could not parse — try "53°18\'55.8"N 9°51\'37.3"E" or "53.31550, 9.86036".',
      );
      return;
    }
    setCoordsBusy(true);
    let formatted = `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`;
    let countryCode: string | undefined;
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${parsed.lat},${parsed.lng}&key=${API_KEY}`,
      );
      if (r.ok) {
        const j = (await r.json()) as {
          status?: string;
          results?: Array<{
            formatted_address?: string;
            address_components?: Array<{ short_name?: string; types?: string[] }>;
          }>;
        };
        if (j.status === 'OK' && j.results?.[0]) {
          formatted = j.results[0].formatted_address ?? formatted;
          countryCode = j.results[0].address_components?.find((c) =>
            c.types?.includes('country'),
          )?.short_name;
        }
      }
    } catch {
      // reverse-geocode is best-effort — fall back to the decimal string.
    }
    setCoordsBusy(false);
    setPicked({
      formatted,
      lat: parsed.lat,
      lng: parsed.lng,
      countryCode,
    });
  };

  useEffect(() => {
    if (!API_KEY) return;
    let cancelled = false;
    let mounted: HTMLElement | null = null;

    (async () => {
      try {
        await loadGoogleMaps(API_KEY);
        if (cancelled || !containerRef.current || !window.google?.maps?.importLibrary) {
          throw new Error('Google Maps importLibrary unavailable');
        }
        const lib = await window.google.maps.importLibrary('places');
        const Ctor = lib.PlaceAutocompleteElement;
        if (cancelled || !containerRef.current || !Ctor) {
          throw new Error('PlaceAutocompleteElement unavailable');
        }

        const el = new Ctor({ types: ['address'] });
        // The web component renders its own input. Style it via CSS variables.
        el.style.width = '100%';
        el.setAttribute('placeholder', 'Start typing your address…');

        el.addEventListener('gmp-select', async (event: Event) => {
          const ev = event as GmpSelectEvent;
          const prediction = ev.placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          const { place: details } = await place.fetchFields({
            fields: ['formattedAddress', 'location', 'addressComponents', 'id'],
          });
          if (!details?.location) return;
          const country = details.addressComponents?.find((c) =>
            c.types?.includes('country'),
          )?.shortText;
          const addr: CustomAddress = {
            formatted: details.formattedAddress ?? '',
            lat: details.location.lat(),
            lng: details.location.lng(),
            placeId: details.id ?? undefined,
            countryCode: country ?? undefined,
          };
          setPicked(addr);
        });

        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(el);
        mounted = el;
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        console.error('[gmaps] failed:', err);
        setError('Could not load Google Places — check API key & domain restrictions.');
      }
    })();

    return () => {
      cancelled = true;
      if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);
    };
  }, []);

  const handleStart = () => {
    if (!picked) return;
    setCustomAddress(picked);
    selectHouse('custom');
    const params = new URLSearchParams({
      address: picked.formatted,
      lat: picked.lat.toString(),
      lng: picked.lng.toString(),
      ...(picked.placeId ? { placeId: picked.placeId } : {}),
    });
    router.push(`/design/custom?${params.toString()}`);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-8 rounded-3xl border border-zinc-200/70 bg-white p-7"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50">
          <svg className="h-4 w-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
          </svg>
        </span>
        <h3 className="text-[16px] font-bold tracking-tight text-zinc-900">
          Enter your address
        </h3>
        <span className="ml-auto rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700">
          Google Places
        </span>
      </div>
      <p className="mb-4 text-[13px] text-zinc-500">
        Our in-house engine sizes the PV / storage / heat-pump bundle and computes price, payback
        and CO₂ savings against 1,620 real Iconic deliveries. The 3D scene on the side is just
        the visualisation — built live from satellite imagery to make the design tangible.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          {!ready && !error && (
            <div className="flex h-12 w-full items-center rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 text-[14px] text-zinc-400">
              Loading address search…
            </div>
          )}
          <div
            ref={containerRef}
            className="reonic-place-autocomplete"
            style={{ display: ready ? 'block' : 'none' }}
          />
        </div>
        <button
          onClick={handleStart}
          disabled={!picked}
          className="group flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-[14px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
        >
          Design my system
          <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>

      {picked && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50/60 px-3 py-2 text-[12px] text-blue-700">
          <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
          </svg>
          <span className="truncate font-medium">{picked.formatted}</span>
          <span className="ml-auto font-mono text-[10.5px] text-blue-500">
            {picked.lat.toFixed(4)}, {picked.lng.toFixed(4)}
          </span>
        </div>
      )}

      {/* GPS coordinates fallback — accepts Google's DMS copy-paste
          ("53°18'55.8\"N 9°51'37.3\"E") or plain decimal. */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-400">
          Or
        </span>
        <input
          type="text"
          value={coordsInput}
          onChange={(e) => {
            setCoordsInput(e.target.value);
            if (coordsError) setCoordsError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !coordsBusy) handleCoordsSubmit();
          }}
          placeholder={`paste GPS coordinates — e.g. 53°18'55.8"N 9°51'37.3"E`}
          className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-[12.5px] font-mono text-zinc-700 placeholder:text-zinc-400 focus:border-blue-300 focus:bg-white focus:outline-none"
        />
        <button
          onClick={handleCoordsSubmit}
          disabled={coordsBusy || !coordsInput.trim()}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-semibold text-zinc-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {coordsBusy ? 'Resolving…' : 'Use'}
        </button>
      </div>
      {coordsError && (
        <div className="mt-2 text-[11.5px] text-amber-700">{coordsError}</div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          ⚠ {error} Use one of the demo houses below for now.
        </div>
      )}

      <style jsx global>{`
        .reonic-place-autocomplete gmp-place-autocomplete {
          width: 100%;
          --gmp-place-autocomplete-input-background: #fafafa;
          --gmp-place-autocomplete-input-border: 1px solid #e4e4e7;
          --gmp-place-autocomplete-input-border-radius: 12px;
          --gmp-place-autocomplete-input-color: #18181b;
          --gmp-place-autocomplete-input-font-size: 14px;
          --gmp-place-autocomplete-input-height: 48px;
          --gmp-place-autocomplete-input-padding: 0 16px 0 44px;
          --gmp-place-autocomplete-input-placeholder-color: #a1a1aa;
        }
      `}</style>
    </motion.section>
  );
}
