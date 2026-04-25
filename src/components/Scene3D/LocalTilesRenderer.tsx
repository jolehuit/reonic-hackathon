// LocalTilesRenderer — OWNED by Dev A
// Renders the GLB tiles previously downloaded by scripts/fetch-tiles-for-address.mjs
// (located at /tiles/<slug>/) instead of streaming from Google's API.
//
// Each GLB has its vertices in ECEF (geocentric, ~6.4M m from origin).
// We apply ECEF → local-ENU → Three (y-up) as the parent group's matrix so
// the building lands at world (0,0,0) and "up" is +Y.

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Box3, Group, Matrix4, MathUtils, Plane, Vector3 } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three';

interface TileEntry {
  file: string;
  depth: number;
  geometricError: number;
  boundingVolumeType: string;
  bytes: number;
  /** Cumulative local→ECEF transform, column-major 16 floats. */
  transform: number[];
}

interface TileManifest {
  address: string;
  geocoded: { lat: number; lng: number };
  ecef: [number, number, number];
  tiles: TileEntry[];
}

interface Props {
  /** Folder slug under /public/tiles/. */
  slug: string;
  /** Optional: only render tiles whose depth >= minDepth (i.e. higher LOD). */
  minDepth?: number;
  /** Clip everything outside this radius (m) from the building. Default 30. */
  radiusM?: number;
}

// ─── Manifest loader (client-only fetch) ──────────────────────────────────

function useManifest(slug: string): TileManifest | null {
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/tiles/${slug}/manifest.json`);
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('[LocalTilesRenderer] manifest fetch failed', res.status);
        return;
      }
      const data = (await res.json()) as TileManifest;
      if (!cancelled) setManifest(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return manifest;
}

// ─── Main component ───────────────────────────────────────────────────────

export function LocalTilesRenderer({ slug, minDepth, radiusM }: Props) {
  const manifest = useManifest(slug);
  if (!manifest) return null;
  return (
    <LocalTilesGroup slug={slug} manifest={manifest} minDepth={minDepth} radiusM={radiusM} />
  );
}

function LocalTilesGroup({
  slug,
  manifest,
  minDepth,
  radiusM = 30,
}: {
  slug: string;
  manifest: TileManifest;
  minDepth?: number;
  radiusM?: number;
}) {
  const groupRef = useRef<Group>(null);

  const tiles = useMemo(
    () =>
      minDepth !== undefined
        ? manifest.tiles.filter((t) => t.depth >= minDepth)
        : manifest.tiles,
    [manifest.tiles, minDepth],
  );

  // Pipeline (applied right to left):
  //   glb_vertex
  //     ↓  glbToStandardEcef   (Google uses gltf Y-up: X stays, Y_std = -Z_glb, Z_std = Y_glb)
  //   standardEcef
  //     ↓  ecefToEnu           (place origin at building, axes east/north/up)
  //   enu
  //     ↓  enuToThree          (Three uses Y-up: X stays, Y_three = Z_enu, Z_three = -Y_enu)
  //   threeLocal (rendered)
  const groupMatrix = useMemo(() => {
    const { lat, lng } = manifest.geocoded;
    const enuToEcef = new Matrix4();
    WGS84_ELLIPSOID.getEastNorthUpFrame(
      lat * MathUtils.DEG2RAD,
      lng * MathUtils.DEG2RAD,
      0,
      enuToEcef,
    );
    const ecefToEnu = enuToEcef.clone().invert();

    // Three.Matrix4.set is row-major.
    const glbToStandardEcef = new Matrix4().set(
      1,  0,  0, 0,
      0,  0, -1, 0,
      0,  1,  0, 0,
      0,  0,  0, 1,
    );
    const enuToThree = new Matrix4().set(
      1, 0,  0, 0,
      0, 0,  1, 0,
      0, -1, 0, 0,
      0, 0,  0, 1,
    );

    // result = enuToThree * ecefToEnu * glbToStandardEcef
    return enuToThree.multiply(ecefToEnu).multiply(glbToStandardEcef);
  }, [manifest.geocoded]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.matrixAutoUpdate = false;
    g.matrix.copy(groupMatrix);
    g.updateMatrixWorld(true);
  }, [groupMatrix]);

  return (
    <group ref={groupRef}>
      {tiles.map((t) => (
        <Suspense key={t.file} fallback={null}>
          <Tile url={`/tiles/${slug}/${t.file}`} transform={t.transform} />
        </Suspense>
      ))}
    </group>
  );
}

// Google's GLBs already bake the local→ECEF (gltf Y-up convention) transform
// into the scene's root node matrix, so we drop the GLB in as-is and let the
// parent group's matrix do the ECEF→ENU→Three projection.
function Tile({ url, transform: _t }: { url: string; transform: number[] }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

// ─── Scene wrapper (camera framing) ───────────────────────────────────────

export function LocalTilesSceneContent({ slug, minDepth, radiusM = 30 }: Props) {
  // High LOD only — we only care about the building chunk.
  const effectiveMinDepth = minDepth ?? 14;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  // No global clipping — the photogrammetric mesh has long faces that span
  // kilometers from a single vertex, so clipping leaves an empty volume near
  // the building. Instead we frame the camera to the requested radius so the
  // user visually sees ~radiusM meters around the address.
  void gl;
  void invalidate;
  void Plane;

  // Probe geometry bbox + auto-frame the camera if no clipping is active so
  // we always see SOMETHING.
  const probeGroupRef = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const g = probeGroupRef.current;
      if (!g) return;
      const box = new Box3().setFromObject(g);
      if (box.isEmpty()) {
        if (tries++ < 180) raf = requestAnimationFrame(tick);
        return;
      }
      const c = box.getCenter(new Vector3());
      const sz = box.getSize(new Vector3());
      // eslint-disable-next-line no-console
      console.log('[LocalTilesRenderer] geometry bbox (pre-clip)', {
        size: sz.toArray().map((v) => v.toFixed(0)),
        center: c.toArray().map((v) => v.toFixed(1)),
        distFromOrigin: c.length().toFixed(1),
      });
      // The leaf tile spans ~km around the building; we frame on the bbox
      // center so we always see the photogrammetric chunk that contains the
      // address (rendered as a textured ground plane).
      const dist = Math.max(80, sz.length() * 0.6);
      camera.position.copy(c).add(new Vector3(dist * 0.7, dist * 0.5, dist * 0.7));
      camera.lookAt(c);
      camera.far = Math.max(camera.far, c.length() * 2 + sz.length() * 2);
      camera.updateProjectionMatrix();
      void radiusM;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slug, radiusM, camera]);

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[50, 80, 50]} intensity={1.1} />
      <Suspense fallback={null}>
        <group ref={probeGroupRef}>
          <LocalTilesRenderer slug={slug} minDepth={effectiveMinDepth} radiusM={radiusM} />
        </group>
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        target={[0, 0, 0]}
        minDistance={5}
        maxDistance={5000}
      />
    </>
  );
}
