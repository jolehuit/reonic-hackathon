// Source switcher — OWNED by Dev A
// Reads ?source=<mode> from the URL to pick which 3D pipeline to run:
//   gemini     → Gemini Vision only (default)
//   osm        → OSM footprint + Gemini Vision details (most fidelity from
//                cadastral data + AI)
//   tiles      → Google Photorealistic 3D Tiles (raw photogrammetric mesh)

'use client';

import { useEffect, useState } from 'react';

export type SceneSource = 'gemini' | 'osm' | 'tiles';

const VALID: ReadonlyArray<SceneSource> = ['gemini', 'osm', 'tiles'];

function readFromUrl(): SceneSource {
  if (typeof window === 'undefined') return 'tiles';
  const param = new URLSearchParams(window.location.search).get('source');
  if (VALID.includes(param as SceneSource)) return param as SceneSource;
  return 'tiles';
}

export function useSceneSource(): SceneSource {
  const [source, setSource] = useState<SceneSource>(() => readFromUrl());
  useEffect(() => {
    const current = readFromUrl();
    setSource((prev) => (prev === current ? prev : current));
    const onPop = () => setSource(readFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return source;
}
