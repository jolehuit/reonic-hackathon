// Headless-screenshot target. Renders ONLY the Google Maps JS tilted
// satellite view at full viewport, ready for Playwright to capture.
// URL: /oblique?lat=...&lng=...&zoom=19&heading=0&tilt=45

'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ObliquePage() {
  const sp = useSearchParams();
  const lat = parseFloat(sp.get('lat') ?? '');
  const lng = parseFloat(sp.get('lng') ?? '');
  const zoom = clamp(parseFloat(sp.get('zoom') ?? '19'), 17, 21);
  const heading = parseFloat(sp.get('heading') ?? '0');
  const tilt = clamp(parseFloat(sp.get('tilt') ?? '45'), 0, 67);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return;

    const init = () => {
      if (!ref.current) return;
      const g = (window as unknown as { google?: { maps?: typeof google.maps } }).google;
      if (!g?.maps) return;
      const map = new g.maps.Map(ref.current, {
        center: { lat, lng },
        zoom,
        tilt,
        heading,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        gestureHandling: 'none',
        keyboardShortcuts: false,
        clickableIcons: false,
      });
      new g.maps.Marker({
        position: { lat, lng },
        map,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      });
      // Signal "ready for screenshot" once tiles have settled.
      let stable = 0;
      const settle = () => {
        const w = window as unknown as { __obliqueStable?: number };
        stable++;
        w.__obliqueStable = stable;
      };
      g.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        const tick = () => {
          settle();
          if (stable < 30) requestAnimationFrame(tick);
        };
        tick();
      });
    };

    if ((window as unknown as { google?: unknown }).google) {
      init();
      return;
    }
    let s = document.querySelector<HTMLScriptElement>('script[data-gmaps-oblique]');
    if (!s) {
      s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
      s.async = true;
      s.defer = true;
      s.dataset.gmapsOblique = '1';
      document.head.appendChild(s);
    }
    s.addEventListener('load', init);
    return () => s?.removeEventListener('load', init);
  }, [lat, lng, zoom, heading, tilt]);

  return <div ref={ref} className="fixed inset-0 bg-white" />;
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
