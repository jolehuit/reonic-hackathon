// Google Photorealistic 3D Tiles renderer — OWNED by Dev A
// Streams the actual photogrammetric mesh of the address from Google's Tile
// API and focuses the R3F camera on the building.
//
// Two camera modes:
//   1. Orbit mode (default): azimuth + range + altitude around (lat, lng).
//   2. Explicit mode: cameraLat/cameraLng/cameraAlt + targetLat/targetLng/targetAlt.
//      Used by the facade capture script to frame each facade perpendicularly.
//
// Coordinates passed to the Ellipsoid API are in RADIANS. The Canvas camera
// lives in ECEF; we compute its position via the local ENU frame.
//
// Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY at build time.

'use client';

import { Suspense, useContext, useEffect, useMemo, useState } from 'react';
import { Matrix4, Plane, Vector3, MathUtils } from 'three';
import { useThree } from '@react-three/fiber';
import {
  TilesRenderer,
  TilesPlugin,
  TilesRendererContext,
  GlobeControls,
  TilesAttributionOverlay,
} from '3d-tiles-renderer/r3f';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';

/** Polygon vertex in geographic degrees. */
export interface ClipVertex {
  lat: number;
  lng: number;
}

/** Clip everything outside this footprint (extruded vertically). */
export interface ClipPolygon {
  /** Polygon vertices, CCW order recommended. Last vertex may equal first. */
  vertices: ClipVertex[];
  /** Top of clip volume above terrain (meters). */
  topAlt: number;
  /** Bottom of clip volume above terrain (meters). Default 0 (ground). */
  bottomAlt?: number;
}

interface OrbitProps {
  mode?: 'orbit';
  lat: number;
  lng: number;
  altitude?: number;
  range?: number;
  azimuth?: number;
  fov?: number;
  lockCamera?: boolean;
  clipPolygon?: ClipPolygon;
}

interface ExplicitProps {
  mode: 'explicit';
  cameraLat: number;
  cameraLng: number;
  cameraAlt: number;
  targetLat: number;
  targetLng: number;
  targetAlt: number;
  fov?: number;
  lockCamera?: boolean;
  clipPolygon?: ClipPolygon;
}

type Props = OrbitProps | ExplicitProps;

export function Tiles3DRenderer(props: Props) {
  const apiToken = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiToken) {
    return <MissingKeyPlaceholder />;
  }
  const lockCamera = props.lockCamera ?? false;
  return (
    <Suspense fallback={null}>
      <TilesRenderer>
        <TilesPlugin
          plugin={GoogleCloudAuthPlugin}
          args={[{ apiToken, autoRefreshToken: true }]}
        />
        <FocusCameraOnBuilding {...props} />
        {props.clipPolygon && <BuildingClipper polygon={props.clipPolygon} />}
        {!lockCamera && <GlobeControls enableDamping />}
        <TilesAttributionOverlay />
      </TilesRenderer>
    </Suspense>
  );
}

// ─── Camera focus ──────────────────────────────────────────────────────────

function FocusCameraOnBuilding(props: Props) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const tiles = useContext(TilesRendererContext);

  const isExplicit = props.mode === 'explicit';
  const initialAz = !isExplicit ? props.azimuth ?? 180 : 0;
  const [azimuth, setAzimuth] = useState(initialAz);

  useEffect(() => {
    if (!isExplicit) setAzimuth(props.azimuth ?? 180);
  }, [isExplicit, props]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      __setCameraAzimuth?: (deg: number) => void;
    };
    w.__setCameraAzimuth = (deg: number) => setAzimuth(((deg % 360) + 360) % 360);
    return () => {
      delete w.__setCameraAzimuth;
    };
  }, []);

  useEffect(() => {
    if (!tiles) return;

    const apply = () => {
      const ellipsoid = tiles.ellipsoid;
      if (!ellipsoid) return;

      let cameraEcef: Vector3;
      let targetEcef: Vector3;

      if (props.mode === 'explicit') {
        cameraEcef = new Vector3();
        ellipsoid.getCartographicToPosition(
          props.cameraLat * MathUtils.DEG2RAD,
          props.cameraLng * MathUtils.DEG2RAD,
          props.cameraAlt,
          cameraEcef,
        );
        targetEcef = new Vector3();
        ellipsoid.getCartographicToPosition(
          props.targetLat * MathUtils.DEG2RAD,
          props.targetLng * MathUtils.DEG2RAD,
          props.targetAlt,
          targetEcef,
        );
      } else {
        const latRad = props.lat * MathUtils.DEG2RAD;
        const lngRad = props.lng * MathUtils.DEG2RAD;
        const azRad = azimuth * MathUtils.DEG2RAD;
        const TERRAIN_M = 60;
        const enu = new Matrix4();
        ellipsoid.getEastNorthUpFrame(latRad, lngRad, TERRAIN_M, enu);
        const range = props.range ?? 120;
        const altitude = props.altitude ?? 90;
        const east = -range * Math.sin(azRad);
        const north = -range * Math.cos(azRad);
        cameraEcef = new Vector3(east, north, altitude).applyMatrix4(enu);
        targetEcef = new Vector3();
        ellipsoid.getCartographicToPosition(latRad, lngRad, TERRAIN_M + 8, targetEcef);
      }

      const cameraUp = cameraEcef.clone().normalize();
      camera.position.copy(cameraEcef);
      camera.up.copy(cameraUp);
      camera.lookAt(targetEcef);

      const persp = camera as typeof camera & {
        near?: number;
        far?: number;
        fov?: number;
        updateProjectionMatrix: () => void;
      };
      const fov = props.fov;
      if (fov !== undefined) persp.fov = fov;
      persp.near = 1;
      persp.far = 50_000;
      persp.updateProjectionMatrix();

      const w = window as unknown as { __cameraReady?: boolean };
      w.__cameraReady = true;
      // eslint-disable-next-line no-console
      console.log('[Tiles3DRenderer] applied', {
        mode: props.mode ?? 'orbit',
        cam: cameraEcef.toArray().map((v) => Math.round(v)),
        tgt: targetEcef.toArray().map((v) => Math.round(v)),
        dist: Math.round(cameraEcef.distanceTo(targetEcef)),
        fov: persp.fov,
      });
      invalidate();
    };

    apply();
    tiles.addEventListener('load-tileset', apply);
    return () => tiles.removeEventListener('load-tileset', apply);
    // We deliberately depend on the full props object + azimuth so any
    // upstream change re-applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, props, azimuth, camera, invalidate]);

  return null;
}

// ─── Building clipper ─────────────────────────────────────────────────────
// Builds a set of THREE.Plane clipping planes from the OSM polygon (one per
// edge, normal pointing inward) plus a bottom and top plane (extruded volume).
// Sets gl.clippingPlanes globally so the photogrammetric tiles outside the
// volume are discarded — only the target building's mesh remains.

function BuildingClipper({ polygon }: { polygon: ClipPolygon }) {
  const tiles = useContext(TilesRendererContext);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const verts = useMemo(() => {
    const v = polygon.vertices.slice();
    if (v.length >= 2) {
      const a = v[0];
      const b = v[v.length - 1];
      if (a.lat === b.lat && a.lng === b.lng) v.pop();
    }
    return v;
  }, [polygon.vertices]);

  useEffect(() => {
    if (!tiles?.ellipsoid || verts.length < 3) return;
    const ellipsoid = tiles.ellipsoid;

    // Convert polygon vertices to ECEF at terrain height.
    const TERRAIN_M = 60;
    const bottomAlt = polygon.bottomAlt ?? 0;
    const ecefVerts = verts.map((v) => {
      const p = new Vector3();
      ellipsoid.getCartographicToPosition(
        v.lat * MathUtils.DEG2RAD,
        v.lng * MathUtils.DEG2RAD,
        TERRAIN_M,
        p,
      );
      return p;
    });

    // Centroid (used to flip normals to point inward).
    const centroid = new Vector3();
    for (const p of ecefVerts) centroid.add(p);
    centroid.divideScalar(ecefVerts.length);

    // Local up at centroid (for top/bottom horizontal planes).
    const up = centroid.clone().normalize();

    const planes: Plane[] = [];

    // Vertical planes — one per polygon edge.
    for (let i = 0; i < ecefVerts.length; i++) {
      const a = ecefVerts[i];
      const b = ecefVerts[(i + 1) % ecefVerts.length];
      const edgeDir = b.clone().sub(a).normalize();
      // Inward normal candidate: cross of local up and edge direction.
      const upAtA = a.clone().normalize();
      const normal = upAtA.clone().cross(edgeDir).normalize();
      // Flip if it points away from the centroid.
      const toCentroid = centroid.clone().sub(a).normalize();
      if (normal.dot(toCentroid) < 0) normal.negate();
      // Plane: n·X + c = 0; we want n·X >= -c → c = -n·a
      const plane = new Plane(normal, -normal.dot(a));
      planes.push(plane);
    }

    // Bottom plane: above ground (normal pointing UP at centroid).
    const bottomPoint = new Vector3();
    ellipsoid.getCartographicToPosition(
      (centroid.length() / ellipsoid.radius.x) * 0, // unused — we use centroid lat/lng below
      0,
      0,
      bottomPoint,
    );
    // Compute centroid lat/lng/alt from ECEF.
    const cart = { lat: 0, lon: 0, height: 0 };
    ellipsoid.getPositionToCartographic(centroid, cart);
    const bottomEcef = new Vector3();
    ellipsoid.getCartographicToPosition(cart.lat, cart.lon, TERRAIN_M + bottomAlt, bottomEcef);
    const topEcef = new Vector3();
    ellipsoid.getCartographicToPosition(cart.lat, cart.lon, TERRAIN_M + polygon.topAlt, topEcef);

    const bottomNormal = up.clone(); // pointing up → keep above
    const topNormal = up.clone().negate(); // pointing down → keep below
    planes.push(new Plane(bottomNormal, -bottomNormal.dot(bottomEcef)));
    planes.push(new Plane(topNormal, -topNormal.dot(topEcef)));

    gl.clippingPlanes = planes;
    gl.localClippingEnabled = true;
    invalidate();

    // eslint-disable-next-line no-console
    console.log('[BuildingClipper] applied', { sides: ecefVerts.length, top: polygon.topAlt });

    return () => {
      gl.clippingPlanes = [];
      invalidate();
    };
  }, [tiles, verts, polygon.topAlt, polygon.bottomAlt, gl, invalidate]);

  return null;
}

function MissingKeyPlaceholder() {
  return (
    <mesh position={[0, 1, 0]}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#ff5555" wireframe />
    </mesh>
  );
}
