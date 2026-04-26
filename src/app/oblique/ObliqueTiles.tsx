'use client';

// Headless-screenshot target for the AI input. Renders Google Photorealistic
// 3D Tiles via NASA-AMMOS `3d-tiles-renderer` on top of Three.js (lighter
// alternative to CesiumJS — same tiles, smaller bundle, no widgets stack).
//
// We create the WebGLRenderer with `preserveDrawingBuffer: true` so that
// Playwright can screenshot the canvas just like the previous Cesium impl.
//
// URL: /oblique?lat=...&lng=...&heading=0&tilt=60&range=110

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export function ObliqueTiles() {
  const sp = useSearchParams();
  const lat = parseFloat(sp.get('lat') ?? '');
  const lng = parseFloat(sp.get('lng') ?? '');
  const headingDeg = parseFloat(sp.get('heading') ?? '0');
  const tiltDeg = parseFloat(sp.get('tilt') ?? '60');
  const range = parseFloat(sp.get('range') ?? '220');
  const height = parseFloat(sp.get('height') ?? '50');
  // Elevation of the ground above the WGS84 ellipsoid in metres. Forwarded
  // by /api/aerial after a Google Elevation API lookup so we can plant the
  // marker AND recenter the camera at the right altitude. Falls back to a
  // safe European default (~100 m).
  const groundElev = parseFloat(sp.get('elev') ?? '100');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !ref.current) return;

    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { TilesRenderer, WGS84_ELLIPSOID } = await import('3d-tiles-renderer');
      const { GoogleCloudAuthPlugin } = await import('3d-tiles-renderer/plugins');
      if (cancelled || !ref.current) return;

      const container = ref.current;
      const w = container.clientWidth;
      const h = container.clientHeight;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true, // CRITICAL — Playwright reads the canvas
      });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h);
      renderer.setClearColor(0xffffff, 1);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // Far plane huge — ECEF positions are ~6.4e6 m from origin.
      const camera = new THREE.PerspectiveCamera(60, w / h, 1, 4e7);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x808080, 1.2));

      // Geo helpers — convert lat/lng to ECEF and build local ENU basis.
      const DEG = Math.PI / 180;
      const target = new THREE.Vector3();
      WGS84_ELLIPSOID.getCartographicToPosition(lat * DEG, lng * DEG, 0, target);
      const east = new THREE.Vector3();
      const north = new THREE.Vector3();
      const up = new THREE.Vector3();
      WGS84_ELLIPSOID.getEastNorthUpAxes(lat * DEG, lng * DEG, east, north, up);

      const hRad = headingDeg * DEG;
      const tRad = tiltDeg * DEG;
      // Fix camera height above ground at `height` m and derive the horizontal
      // distance from the tilt angle. `range` is kept as a fallback only when
      // tilt is ~0 (would divide by ~0). This guarantees a consistent altitude
      // regardless of geoid undulation / building height.
      const offU = height;
      const horizDist = Math.tan(tRad) > 1e-3 ? height / Math.tan(tRad) : range;
      const offE = horizDist * Math.sin(hRad);
      const offN = horizDist * Math.cos(hRad);

      // Camera anchor — anchored at the actual ground elevation passed by
      // /api/aerial (Google Elevation API), so the lookAt is at real ground
      // level and the framing is consistent across locations regardless of
      // geoid undulation.
      const anchor = target.clone().addScaledVector(up, groundElev);
      const frameCamera = () => {
        camera.position
          .copy(anchor)
          .addScaledVector(east, offE)
          .addScaledVector(north, offN)
          .addScaledVector(up, offU);
        const aim = anchor.clone().addScaledVector(up, 8);
        camera.up.copy(up);
        camera.lookAt(aim);
      };
      frameCamera();

      const tiles = new TilesRenderer();
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey }));
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.errorTarget = 6;
      scene.add(tiles.group);


      // GPS marker — small red dot placed at building-roof height (~8 m
      // above the real ground elevation). In the oblique view, this is what
      // the camera "sees" at the lat/lng direction → the dot lands ON the
      // visible roof rather than next to the building due to parallax.
      const ROOF_HEIGHT_M = 8;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false }),
      );
      sphere.renderOrder = 999;
      sphere.position.copy(target).addScaledVector(up, groundElev + ROOF_HEIGHT_M);
      scene.add(sphere);

      let stableFrames = 0;
      let lastProgress = -1;
      let everSawProgressUnder1 = false;
      let raf = 0;
      const tick = () => {
        if (cancelled) return;
        camera.updateMatrixWorld();
        tiles.update();
        // Track whether tiles ever entered an "in-progress" state. Without this,
        // loadProgress stays at the trivial 1.0 (nothing requested yet) and the
        // headless wait fires before any tiles get a chance to load.
        const progress = tiles.loadProgress;
        if (progress < 1) everSawProgressUnder1 = true;
        renderer.render(scene, camera);
        if (everSawProgressUnder1 && progress >= 1 && progress === lastProgress)
          stableFrames++;
        else stableFrames = 0;
        lastProgress = progress;
        (window as unknown as { __obliqueStable?: number }).__obliqueStable = stableFrames;
        raf = requestAnimationFrame(tick);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(raf);
        try {
          renderer.dispose();
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement);
          }
          tiles.dispose();
        } catch {
          /* ignore */
        }
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [lat, lng, headingDeg, tiltDeg, range, height, groundElev]);

  return <div ref={ref} className="fixed inset-0 bg-white" />;
}
