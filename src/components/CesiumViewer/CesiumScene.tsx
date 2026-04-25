// Cesium-powered photogrammetric viewer — OWNED by Dev A (build-viewer agent)
// Streams Google Photorealistic 3D Tiles, clipped to a 30m diamond (square
// rotated 45°) around the building, and exposes 2D top-down + 3D oblique
// camera presets matching the Reonic capture style.
//
// This file is the actual CesiumJS implementation; it MUST stay client-only
// because Cesium relies on `window`, WebGL, and Web Workers loaded from
// /public/cesium (configured via window.CESIUM_BASE_URL in CesiumViewer.tsx).

"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  forwardRef,
  type CSSProperties,
} from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

export type CesiumViewerMode = "2D" | "3D";

export interface CesiumSceneProps {
  lat: number;
  lng: number;
  mode?: CesiumViewerMode;
  /** Compass heading in degrees (0=N, 90=E). Only used in 3D mode. */
  heading?: number;
  /** Diamond half-extent in meters (30 ≈ Reonic suburb shot). */
  clipRadiusM?: number;
  /** Notified whenever the camera heading changes (user drag in 3D mode). */
  onCompassChange?: (heading: number) => void;
  className?: string;
  style?: CSSProperties;
}

export interface CesiumSceneHandle {
  /** Programmatically rotate the 3D camera to a heading in degrees. */
  setHeading: (deg: number) => void;
}

interface CameraPreset {
  range: number;
  pitchDeg: number;
}

const PRESET_3D: CameraPreset = { range: 130, pitchDeg: -35 };
// 2D = strict top-down zoomed on the roof (~80 m camera distance).
const PRESET_2D: CameraPreset = { range: 80, pitchDeg: -89 };

const GROUND_ALT_M = 50; // ellipsoid → ground (Paris-area approx)
const TARGET_ALT_M = 8; // aim point above ground (mid-roof)
const BACKGROUND_CSS = "#ffffff";

function buildDiamondPositions(
  lat: number,
  lng: number,
  radiusM: number,
): Cesium.Cartesian3[] {
  // Square rotated 45° around (lat, lng). The four vertices sit on the
  // local East/North axes at distance `radiusM`. We then convert to ECEF
  // using the local ENU frame so the polygon hugs the curved earth.
  const center = Cesium.Cartesian3.fromDegrees(lng, lat, GROUND_ALT_M);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const offsets: Array<[number, number]> = [
    [0, radiusM], // N
    [radiusM, 0], // E
    [0, -radiusM], // S
    [-radiusM, 0], // W
  ];
  return offsets.map(([east, north]) => {
    const local = new Cesium.Cartesian3(east, north, 0);
    return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
  });
}

function applyCamera(
  viewer: Cesium.Viewer,
  lat: number,
  lng: number,
  headingDeg: number,
  preset: CameraPreset,
): void {
  const aim = Cesium.Cartesian3.fromDegrees(
    lng,
    lat,
    GROUND_ALT_M + TARGET_ALT_M,
  );
  const hpr = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(headingDeg),
    Cesium.Math.toRadians(preset.pitchDeg),
    preset.range,
  );
  // Release any previous lookAt frame, then lock onto the new aim point.
  // We KEEP the lookAt frame active afterwards so mouse drag orbits around
  // the building (instead of free-flying through space).
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.lookAt(aim, hpr);
}

export const CesiumScene = forwardRef<CesiumSceneHandle, CesiumSceneProps>(
  function CesiumScene(
    {
      lat,
      lng,
      mode = "3D",
      heading = 0,
      clipRadiusM = 30,
      onCompassChange,
      className,
      style,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewerRef = useRef<Cesium.Viewer | null>(null);
    const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
    const headingRef = useRef(heading);
    const modeRef = useRef<CesiumViewerMode>(mode);
    const clipRadiusRef = useRef(clipRadiusM);
    const latLngRef = useRef({ lat, lng });
    const onCompassChangeRef = useRef(onCompassChange);

    useEffect(() => {
      onCompassChangeRef.current = onCompassChange;
    }, [onCompassChange]);

    // ── Init Cesium viewer once ─────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        // eslint-disable-next-line no-console
        console.error("[CesiumViewer] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing");
        return;
      }

      const viewer = new Cesium.Viewer(containerRef.current, {
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
        shadows: false,
        shouldAnimate: false,
        requestRenderMode: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        // Disable the default imagery — we'll show a flat sky color and only
        // render the photogrammetric mesh inside the diamond.
        baseLayer: false as unknown as Cesium.ImageryLayer,
      });

      viewerRef.current = viewer;

      // Strip out the default sky/ground so the page background shows through
      // the clipped-out area, matching the Reonic look.
      viewer.scene.globe.show = false;
      viewer.scene.skyBox.show = false;
      viewer.scene.skyAtmosphere.show = false;
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;
      viewer.scene.fog.enabled = false;
      viewer.scene.backgroundColor =
        Cesium.Color.fromCssColorString(BACKGROUND_CSS);
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

      // Pin marker at the exact target lat/lng so the screenshot shows
      // unambiguously which building the AI cropper should focus on.
      viewer.entities.add({
        id: 'lat-lng-marker',
        position: Cesium.Cartesian3.fromDegrees(
          latLngRef.current.lng,
          latLngRef.current.lat,
          GROUND_ALT_M + TARGET_ALT_M + 6,
        ),
        point: {
          pixelSize: 18,
          color: Cesium.Color.fromCssColorString('#ef4444'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Apply the initial camera before the tileset loads so the user sees
      // the right framing as tiles stream in.
      const initialPreset = modeRef.current === "2D" ? PRESET_2D : PRESET_3D;
      applyCamera(
        viewer,
        latLngRef.current.lat,
        latLngRef.current.lng,
        headingRef.current,
        initialPreset,
      );

      // Notify parent of compass changes when the user drags the camera.
      // We poll via postRender to avoid hooking the controller internals.
      let lastHeading = headingRef.current;
      const removePostRender = viewer.scene.postRender.addEventListener(() => {
        if (!onCompassChangeRef.current) return;
        const headingRad = viewer.camera.heading;
        const deg = ((Cesium.Math.toDegrees(headingRad) % 360) + 360) % 360;
        if (Math.abs(deg - lastHeading) > 0.5) {
          lastHeading = deg;
          headingRef.current = deg;
          onCompassChangeRef.current(deg);
        }
      });

      // Stream Google Photorealistic 3D Tiles and clip to the diamond.
      let cancelled = false;
      (async () => {
        try {
          const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(
            apiKey,
          )}`;
          const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
            showCreditsOnScreen: false,
            maximumScreenSpaceError: 8,
          });
          if (cancelled) {
            tileset.destroy();
            return;
          }

          // Diamond clip — keep only mesh INSIDE the rotated square.
          // ClippingPolygonCollection clips OUTSIDE when inverse=true.
          const diamond = buildDiamondPositions(
            latLngRef.current.lat,
            latLngRef.current.lng,
            clipRadiusRef.current,
          );
          try {
            tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
              polygons: [new Cesium.ClippingPolygon({ positions: diamond })],
              inverse: false,
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              "[CesiumViewer] ClippingPolygons unsupported, falling back to ClippingPlanes",
              err,
            );
            tileset.clippingPlanes = buildDiamondClippingPlanes(
              latLngRef.current.lat,
              latLngRef.current.lng,
              clipRadiusRef.current,
            );
          }

          viewer.scene.primitives.add(tileset);
          tilesetRef.current = tileset;

          // Re-apply camera after tileset registers — some LOD setups change
          // the framing slightly.
          const preset = modeRef.current === "2D" ? PRESET_2D : PRESET_3D;
          applyCamera(
            viewer,
            latLngRef.current.lat,
            latLngRef.current.lng,
            headingRef.current,
            preset,
          );

          // Mark a global so external probes (e.g. Playwright) can wait for
          // the first complete frame.
          interface WindowWithCesiumStatus extends Window {
            __cesiumViewerStatus?: {
              tilesetReady: boolean;
              tilesLoaded: boolean;
              stableFrames: number;
            };
          }
          const w = window as WindowWithCesiumStatus;
          w.__cesiumViewerStatus = {
            tilesetReady: true,
            tilesLoaded: false,
            stableFrames: 0,
          };

          tileset.allTilesLoaded.addEventListener(() => {
            const ws = (window as WindowWithCesiumStatus)
              .__cesiumViewerStatus;
            if (ws) ws.tilesLoaded = true;
          });
          let stable = 0;
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
            if (pending === 0 && pending === lastPending) stable += 1;
            else stable = 0;
            lastPending = pending;
            const ws = (window as WindowWithCesiumStatus)
              .__cesiumViewerStatus;
            if (ws) ws.stableFrames = stable;
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[CesiumViewer] Failed to load 3D Tileset", err);
        }
      })();

      return () => {
        cancelled = true;
        removePostRender();
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.destroy();
        }
        viewerRef.current = null;
        tilesetRef.current = null;
      };
      // Init once — re-mounts handled by parent via key prop.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── React to prop changes ───────────────────────────────────────────
    useEffect(() => {
      latLngRef.current = { lat, lng };
      const viewer = viewerRef.current;
      if (!viewer) return;
      const preset = mode === "2D" ? PRESET_2D : PRESET_3D;
      applyCamera(viewer, lat, lng, headingRef.current, preset);
      // Move the lat/lng marker pin.
      const marker = viewer.entities.getById('lat-lng-marker');
      if (marker) {
        marker.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(lng, lat, GROUND_ALT_M + TARGET_ALT_M + 6),
        );
      }
      // Rebuild clipping diamond around the new center.
      const tileset = tilesetRef.current;
      if (tileset) {
        const positions = buildDiamondPositions(lat, lng, clipRadiusRef.current);
        try {
          tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
            polygons: [new Cesium.ClippingPolygon({ positions })],
            inverse: false,
          });
        } catch {
          tileset.clippingPlanes = buildDiamondClippingPlanes(
            lat,
            lng,
            clipRadiusRef.current,
          );
        }
      }
    }, [lat, lng, mode]);

    useEffect(() => {
      modeRef.current = mode;
      const viewer = viewerRef.current;
      if (!viewer) return;
      const preset = mode === "2D" ? PRESET_2D : PRESET_3D;
      applyCamera(
        viewer,
        latLngRef.current.lat,
        latLngRef.current.lng,
        headingRef.current,
        preset,
      );
    }, [mode]);

    useEffect(() => {
      headingRef.current = heading;
      const viewer = viewerRef.current;
      if (!viewer) return;
      const preset = modeRef.current === "2D" ? PRESET_2D : PRESET_3D;
      applyCamera(
        viewer,
        latLngRef.current.lat,
        latLngRef.current.lng,
        heading,
        preset,
      );
    }, [heading]);

    useEffect(() => {
      clipRadiusRef.current = clipRadiusM;
      const tileset = tilesetRef.current;
      if (!tileset) return;
      const positions = buildDiamondPositions(
        latLngRef.current.lat,
        latLngRef.current.lng,
        clipRadiusM,
      );
      try {
        tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
          polygons: [new Cesium.ClippingPolygon({ positions })],
          inverse: false,
        });
      } catch {
        tileset.clippingPlanes = buildDiamondClippingPlanes(
          latLngRef.current.lat,
          latLngRef.current.lng,
          clipRadiusM,
        );
      }
    }, [clipRadiusM]);

    useImperativeHandle(
      ref,
      () => ({
        setHeading: (deg: number) => {
          headingRef.current = ((deg % 360) + 360) % 360;
          const viewer = viewerRef.current;
          if (!viewer) return;
          const preset = modeRef.current === "2D" ? PRESET_2D : PRESET_3D;
          applyCamera(
            viewer,
            latLngRef.current.lat,
            latLngRef.current.lng,
            headingRef.current,
            preset,
          );
        },
      }),
      [],
    );

    const containerStyle = useMemo<CSSProperties>(
      () => ({
        background: BACKGROUND_CSS,
        ...style,
      }),
      [style],
    );

    return (
      <div
        ref={containerRef}
        className={className}
        style={containerStyle}
      />
    );
  },
);

// ── Fallback clipping (4 planes forming a vertical diamond box) ─────────────
// Used only when ClippingPolygonCollection isn't available (older WebGL1
// contexts). We project the diamond into 4 ECEF planes whose normals point
// inward; Cesium keeps geometry on the +normal side.
function buildDiamondClippingPlanes(
  lat: number,
  lng: number,
  radiusM: number,
): Cesium.ClippingPlaneCollection {
  const center = Cesium.Cartesian3.fromDegrees(lng, lat, GROUND_ALT_M);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  // The 4 inward-pointing normals of the diamond (rotated square) in ENU
  // are unit vectors at 45°, 135°, 225°, 315°.
  const inwardLocal: Array<[number, number]> = [
    [-Math.SQRT1_2, -Math.SQRT1_2], // from NE corner, points SW (inward)
    [Math.SQRT1_2, -Math.SQRT1_2], // from NW corner, points SE
    [Math.SQRT1_2, Math.SQRT1_2], // from SW corner, points NE
    [-Math.SQRT1_2, Math.SQRT1_2], // from SE corner, points NW
  ];
  // Distance from center to each diamond edge = radiusM * cos(45°) = radiusM/√2.
  const edgeDistance = radiusM * Math.SQRT1_2;
  const collection = new Cesium.ClippingPlaneCollection({
    modelMatrix: enu,
    unionClippingRegions: false,
  });
  for (const [e, n] of inwardLocal) {
    collection.add(
      new Cesium.ClippingPlane(new Cesium.Cartesian3(e, n, 0), edgeDistance),
    );
  }
  return collection;
}
