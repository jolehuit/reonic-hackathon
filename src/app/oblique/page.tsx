// Headless-screenshot target for the AI input. Renders Google Photorealistic
// 3D Tiles via CesiumJS at a tilted angle around the lat/lng. Cesium creates
// its WebGL context with `preserveDrawingBuffer: true` so headless Playwright
// captures the canvas correctly (Google Maps JS does not, hence Cesium).
//
// URL: /oblique?lat=...&lng=...&zoom=19&heading=0&tilt=60

'use client';

import dynamic from 'next/dynamic';

const ObliqueCesium = dynamic(() => import('./ObliqueCesium').then((m) => m.ObliqueCesium), {
  ssr: false,
});

export default function ObliquePage() {
  return <ObliqueCesium />;
}
