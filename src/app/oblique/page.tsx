// Headless-screenshot target for the AI input. Renders Google Photorealistic
// 3D Tiles via NASA-AMMOS `3d-tiles-renderer` (Three.js) at a tilted angle
// around the lat/lng. The renderer uses `preserveDrawingBuffer: true` so
// headless Playwright captures the canvas correctly.
//
// URL: /oblique?lat=...&lng=...&heading=0&tilt=60&range=110

'use client';

import dynamic from 'next/dynamic';

const ObliqueTiles = dynamic(
  () => import('./ObliqueTiles').then((m) => m.ObliqueTiles),
  { ssr: false },
);

export default function ObliquePage() {
  return <ObliqueTiles />;
}
