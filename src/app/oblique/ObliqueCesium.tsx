'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export function ObliqueCesium() {
  const sp = useSearchParams();
  const lat = parseFloat(sp.get('lat') ?? '');
  const lng = parseFloat(sp.get('lng') ?? '');
  const zoom = parseFloat(sp.get('zoom') ?? '19');
  const headingDeg = parseFloat(sp.get('heading') ?? '0');
  const tiltDeg = parseFloat(sp.get('tilt') ?? '60');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    const baseUrl = process.env.NEXT_PUBLIC_CESIUM_BASE_URL ?? '/cesium';

    let cancelled = false;
    let viewer: import('cesium').Viewer | null = null;

    (async () => {
      // Cesium reads window.CESIUM_BASE_URL once at first import.
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = baseUrl;
      // Inject widgets CSS (the bundler import causes Turbopack issues).
      if (!document.querySelector('link[data-cesium-widgets]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${baseUrl}/Widgets/widgets.css`;
        link.setAttribute('data-cesium-widgets', '');
        document.head.appendChild(link);
      }

      const Cesium = await import('cesium');
      if (cancelled || !ref.current) return;

      viewer = new Cesium.Viewer(ref.current, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        baseLayer: false as unknown as import('cesium').ImageryLayer,
      });

      viewer.scene.skyBox.show = false;
      viewer.scene.skyAtmosphere.show = false;
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;
      viewer.scene.fog.enabled = false;
      viewer.scene.globe.show = false;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#ffffff');

      try {
        const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`;
        const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
          showCreditsOnScreen: false,
          maximumScreenSpaceError: 6,
        });
        if (cancelled) {
          tileset.destroy();
          return;
        }
        viewer.scene.primitives.add(tileset);

        // Bird's-eye oblique: high enough to see the whole roof, ~60° down.
        // pitch = -tiltDeg (60° below horizontal = steep oblique looking down)
        // range = 200m gives good roof framing at zoom 19-20 equivalent.
        const range = 200;
        const aim = Cesium.Cartesian3.fromDegrees(lng, lat, 58);
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.camera.lookAt(
          aim,
          new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(headingDeg),
            Cesium.Math.toRadians(-tiltDeg),
            range,
          ),
        );

        // Red marker pin at the exact lat/lng. Anchor it well above the roof
        // (ground ~58m + 30m clearance) and disable depth-testing so the pin
        // always renders ON TOP of the photogrammetric mesh — like a 2D HTML
        // overlay would on the interactive Maps JS view.
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, 90),
          point: {
            pixelSize: 18,
            color: Cesium.Color.fromCssColorString('#ef4444'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.NONE,
          },
        });

        // Wait until tiles fully loaded + 30 stable frames; expose a global
        // probe Playwright can poll.
        let stableFrames = 0;
        let lastPending = -1;
        viewer.scene.postRender.addEventListener(() => {
          const stats = (
            tileset as unknown as {
              _statistics?: {
                numberOfPendingRequests?: number;
                numberOfTilesProcessing?: number;
              };
            }
          )._statistics;
          const pending =
            (tileset.tilesLoaded ? 0 : 1) +
            (stats?.numberOfPendingRequests ?? 0) +
            (stats?.numberOfTilesProcessing ?? 0);
          if (pending === 0 && pending === lastPending) stableFrames++;
          else stableFrames = 0;
          lastPending = pending;
          (window as unknown as { __obliqueStable?: number }).__obliqueStable = stableFrames;
        });
      } catch (err) {
        console.error('[oblique] tileset load failed', err);
      }
    })();

    return () => {
      cancelled = true;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [lat, lng, zoom, headingDeg, tiltDeg]);

  return <div ref={ref} className="fixed inset-0 bg-white" />;
}
