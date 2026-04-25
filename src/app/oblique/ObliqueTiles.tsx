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

      // Camera anchor — the point the camera orbits around. Starts ~100 m
      // above the ellipsoid (a safe ground-level guess for Europe so the
      // initial camera is never buried under the terrain → tiles can load
      // and the raycast can hit them) and is snapped onto the actual ground
      // point once the raycast finds it.
      const anchor = target.clone().addScaledVector(up, 100);
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

      // GPS marker — small red dot sitting just above the surface at the
      // exact lat/lng. Position is refined by a downward raycast once the
      // tile meshes load, then the camera is recentered on the same point.
      const markerGroup = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false }),
      );
      sphere.renderOrder = 999;
      sphere.position.copy(up).multiplyScalar(0.5);
      markerGroup.add(sphere);
      markerGroup.position.copy(target).addScaledVector(up, 100);
      scene.add(markerGroup);

      const raycaster = new THREE.Raycaster();
      raycaster.far = 10000;
      const downDir = up.clone().multiplyScalar(-1).normalize();
      let dotPlaced = false;
      // Snap-to-building search radius (meters). We sample a grid of downward
      // rays inside this radius around the GPS anchor and keep the HIGHEST
      // hit — typically the roof of the nearest building, even when the raw
      // lat/lng falls on a street or in a yard. This is what makes the dot
      // land on the house in oblique views regardless of GPS imprecision.
      const SNAP_RADIUS = 20;
      const SNAP_SAMPLES = 9; // 9×9 grid → ~5 m spacing within 20 m radius
      const placeDotOnSurface = () => {
        if (dotPlaced) return;
        let bestHit: THREE.Vector3 | null = null;
        let bestHeight = -Infinity;
        const half = Math.floor(SNAP_SAMPLES / 2);
        for (let i = -half; i <= half; i++) {
          for (let j = -half; j <= half; j++) {
            const dx = (i / half) * SNAP_RADIUS;
            const dy = (j / half) * SNAP_RADIUS;
            const origin = target
              .clone()
              .addScaledVector(east, dx)
              .addScaledVector(north, dy)
              .addScaledVector(up, 5000);
            raycaster.set(origin, downDir);
            const hits = raycaster.intersectObject(tiles.group, true);
            if (hits.length === 0) continue;
            const h = hits[0].point.clone().sub(target).dot(up);
            if (h > bestHeight) {
              bestHeight = h;
              bestHit = hits[0].point.clone();
            }
          }
        }
        if (bestHit) {
          markerGroup.position.copy(bestHit);
          // Camera anchor uses the GPS lat/lng at the building's elevation —
          // not the snapped XY — so the framing stays centered on the address
          // even when the dot is offset onto a nearby roof.
          anchor.copy(target).addScaledVector(up, bestHeight);
          frameCamera();
          dotPlaced = true;
        }
      };

      let stableFrames = 0;
      let lastProgress = -1;
      let raf = 0;
      const tick = () => {
        if (cancelled) return;
        camera.updateMatrixWorld();
        tiles.update();
        if (!dotPlaced && tiles.loadProgress >= 1) placeDotOnSurface();
        renderer.render(scene, camera);
        const progress = tiles.loadProgress;
        if (progress >= 1 && progress === lastProgress) stableFrames++;
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
  }, [lat, lng, headingDeg, tiltDeg, range, height]);

  return <div ref={ref} className="fixed inset-0 bg-white" />;
}
