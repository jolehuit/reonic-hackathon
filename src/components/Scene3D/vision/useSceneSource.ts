// Source switcher — OWNED by Dev A
// Reads ?source=<mode> from the URL to pick which 3D pipeline to run:
//   gemini     → Gemini Vision only (faster, less accurate footprint)
//   osm        → OSM footprint + Gemini Vision details (default, recommended)
//
// The historical `tiles` source is mapped to `osm` since the raw 3D Tiles
// renderer was never authored — keep the URL value tolerated for backward
// compatibility with capture scripts that pass ?source=tiles.

'use client';

import { useEffect, useState } from 'react';

export type SceneSource = 'gemini' | 'osm';

const VALID: ReadonlyArray<SceneSource> = ['gemini', 'osm'];

function readFromUrl(): SceneSource {
  if (typeof window === 'undefined') return 'osm';
  const param = new URLSearchParams(window.location.search).get('source');
  if (VALID.includes(param as SceneSource)) return param as SceneSource;
  return 'osm';
}

export function useSceneSource(): SceneSource {
  const [source, setSource] = useState<SceneSource>(() => readFromUrl());
  useEffect(() => {
    const onPop = () => setSource(readFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return source;
}
