// Pure renderer. The chain of API calls (capture → clean → trellis) lives
// in <Orchestrator/>; this component just watches `glbUrl` + `trellisStatus`
// in the store and renders either the rotating wireframe skeleton or the
// loaded GLB, with a 1.5s morph between the two.

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { Box3, BufferGeometry, Group, Mesh, Shape, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

// Wire three-mesh-bvh into Three.js once. Now any geometry with
// `geometry.computeBoundsTree()` builds a BVH, and Mesh.raycast uses it.
// Without this, <Panels/> raycasts walk every triangle linearly — on a
// 50k-face Hunyuan mesh that's still ~125M ops for a typical roof scan.
// With BVH, it's O(log n) per ray → freeze gone.
type BvhAugmentedGeometry = BufferGeometry & {
  computeBoundsTree?: typeof computeBoundsTree;
  disposeBoundsTree?: typeof disposeBoundsTree;
};
type BvhAugmentedMesh = Mesh & { raycast: typeof acceleratedRaycast };
const proto = BufferGeometry.prototype as BvhAugmentedGeometry;
proto.computeBoundsTree = computeBoundsTree;
proto.disposeBoundsTree = disposeBoundsTree;
(Mesh.prototype as BvhAugmentedMesh).raycast = acceleratedRaycast;
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'ready'; glbUrl: string }
  | { kind: 'error' };

// Aesthetic skeleton dimensions — keep the placeholder tall and house-shaped
// regardless of the eventual footprint (which can be wide/squat for some
// demo houses). The GLB replaces this once ready and uses the real
// footprint dimensions to scale itself.
const SKELETON_WIDTH = 4;
const SKELETON_DEPTH = 4.4;
const SKELETON_WALL = 3.5;

export function TrellisModel() {
  const trellisStatus = useStore((s) => s.trellisStatus);
  const glbUrl = useStore((s) => s.glbUrl);
  const { width, depth, wallHeight } = useHouseGeometry();

  const status: Status =
    trellisStatus === 'ready' && glbUrl
      ? { kind: 'ready', glbUrl }
      : trellisStatus === 'error'
      ? { kind: 'error' }
      : trellisStatus === 'generating'
      ? { kind: 'generating' }
      : { kind: 'idle' };

  return (
    <group>
      <Ground />
      <MorphingBuilding
        status={status}
        glbWidth={width}
        glbDepth={depth}
        glbHeight={wallHeight}
      />
    </group>
  );
}

// Wrap skeleton + GLB together so we can cross-fade between them over a
// ~1.5s morph window when status transitions from generating → ready.
function MorphingBuilding({
  status,
  glbWidth,
  glbDepth,
  glbHeight,
}: {
  status: Status;
  glbWidth: number;
  glbDepth: number;
  glbHeight: number;
}) {
  const transitionStartedRef = useRef<number | null>(null);
  const [transitionT, setTransitionT] = useState(0); // 0..1 over MORPH_MS
  const stableSignalledRef = useRef(false);
  const setGlbStable = useStore((s) => s.setGlbStable);
  const glbLoaded = useStore((s) => s.glbLoaded);
  const MORPH_MS = 1500;

  useEffect(() => {
    if (status.kind === 'ready' && transitionStartedRef.current === null) {
      transitionStartedRef.current = performance.now();
    }
    // When the URL changes / we leave 'ready', allow another stable signal.
    if (status.kind !== 'ready') {
      stableSignalledRef.current = false;
    }
  }, [status.kind]);

  useFrame(() => {
    if (transitionStartedRef.current === null) return;
    const elapsed = performance.now() - transitionStartedRef.current;
    const t = Math.min(1, elapsed / MORPH_MS);
    if (t !== transitionT) setTransitionT(t);
    // The morph is visually complete AND the GLB is in the scene. Only flip
    // glbStable once per ready cycle so we don't spam the store every frame.
    if (
      t >= 1 &&
      glbLoaded &&
      status.kind === 'ready' &&
      !stableSignalledRef.current
    ) {
      stableSignalledRef.current = true;
      setGlbStable(true);
    }
  });

  // Easing: smoothstep. Skeleton fade-out is 1-ease(t); GLB fade-in is ease(t).
  const ease = transitionT * transitionT * (3 - 2 * transitionT);
  const skeletonOpacity = status.kind === 'ready' ? 1 - ease : 1;
  const glbOpacity = status.kind === 'ready' ? ease : 0;
  const skeletonScale = status.kind === 'ready' ? 1 + ease * 0.4 : 1;
  const glbScale = status.kind === 'ready' ? 0.6 + ease * 0.4 : 0.6;

  return (
    <>
      {/* Skeleton: visible until morph completes, then unmounted. */}
      {skeletonOpacity > 0.02 && (
        <group scale={skeletonScale}>
          <Skeleton
            width={SKELETON_WIDTH}
            depth={SKELETON_DEPTH}
            height={SKELETON_WALL}
            opacityMul={skeletonOpacity}
            tone={status.kind === 'error' ? 'error' : 'busy'}
          />
        </group>
      )}

      {/* GLB: fades in during the morph window, full opacity afterwards. */}
      {status.kind === 'ready' && (
        <Suspense fallback={null}>
          <group scale={glbScale}>
            <LoadedGlb
              url={status.glbUrl}
              width={glbWidth}
              depth={glbDepth}
              height={glbHeight}
              opacity={glbOpacity}
            />
          </group>
        </Suspense>
      )}
    </>
  );
}

// ─── Skeleton (in-canvas) ───────────────────────────────────────────────────
// Rotating wireframe house silhouette with a vertical scan plane. Narration
// of what's happening lives in the AgentTrace sidebar — no in-scene badge.

function Skeleton({
  width,
  depth,
  height,
  tone = 'busy',
  opacityMul = 1,
}: {
  width: number;
  depth: number;
  height: number;
  tone?: 'busy' | 'error';
  /** Multiplies all rendered material opacities (used during morph fade-out). */
  opacityMul?: number;
}) {
  const houseRef = useRef<Group>(null);
  const wallsRef = useRef<Mesh>(null);
  const roofRef = useRef<Mesh>(null);
  const scanRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);

  // Tall storybook roof so the silhouette reads as "house" not "shed".
  const roofHeight = height * 0.75;
  const totalH = height + roofHeight;
  const planSize = Math.max(width, depth);

  // Triangular gable cross-section, extruded along the depth axis to make a
  // proper house roof (not a 4-sided pyramid).
  const roofShape = useMemo(() => {
    const s = new Shape();
    s.moveTo(-width / 2, 0);
    s.lineTo(width / 2, 0);
    s.lineTo(0, roofHeight);
    s.lineTo(-width / 2, 0);
    return s;
  }, [width, roofHeight]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Continuous slow yaw — looks like the house is being inspected from all
    // sides. ~1 turn every 12 seconds.
    if (houseRef.current) {
      houseRef.current.rotation.y = t * (Math.PI * 2) / 12;
    }
    // Walls + roof: gentle opacity pulse on the wireframe edges. Scaled by
    // opacityMul so the parent can fade us out during the morph.
    const pulse = (0.55 + Math.sin(t * 2.5) * 0.25) * opacityMul;
    const wallsMat = wallsRef.current?.material as { opacity?: number } | undefined;
    if (wallsMat && 'opacity' in wallsMat) wallsMat.opacity = pulse;
    const roofMat = roofRef.current?.material as { opacity?: number } | undefined;
    if (roofMat && 'opacity' in roofMat) roofMat.opacity = pulse;

    // Scan plane sweeping bottom→top→bottom over ~3s.
    if (scanRef.current) {
      const phase = (Math.sin(t * 1.0) + 1) * 0.5;
      scanRef.current.position.y = phase * totalH;
      const mat = scanRef.current.material as { opacity?: number } | undefined;
      if (mat && 'opacity' in mat) mat.opacity = (0.6 - Math.abs(phase - 0.5) * 0.5) * opacityMul;
    }
    // Halo at the ground — slow expand/contract.
    if (haloRef.current) {
      const breath = 1 + (Math.sin(t * 1.6) + 1) * 0.18;
      haloRef.current.scale.set(breath, breath, breath);
      const mat = haloRef.current.material as { opacity?: number } | undefined;
      if (mat && 'opacity' in mat)
        mat.opacity = (0.32 - (Math.sin(t * 1.6) + 1) * 0.1) * opacityMul;
    }
  });

  const color = tone === 'error' ? '#dc2626' : '#3b82f6';
  const glow = tone === 'error' ? '#fca5a5' : '#60a5fa';

  return (
    <group>
      {/* ─── Rotating house skeleton (walls + gable roof) ────────────── */}
      <group ref={houseRef}>
        {/* Walls — wireframe box. Faint solid fill so the silhouette reads. */}
        <mesh ref={wallsRef} position={[0, height / 2, 0]}>
          <boxGeometry args={[width, height, depth]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.08}
            depthWrite={false}
            wireframe={false}
          />
          <Edges color={color} threshold={1} lineWidth={2} />
        </mesh>

        {/* Gable roof — triangular prism extruded from a 2D triangle shape. */}
        <mesh ref={roofRef} position={[0, height, -depth / 2]}>
          <extrudeGeometry args={[roofShape, { depth, bevelEnabled: false }]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.08}
            depthWrite={false}
          />
          <Edges color={color} threshold={1} lineWidth={2} />
        </mesh>
      </group>

      {/* ─── Scan plane traveling vertically (NOT inside the rotating group
          so the scan direction stays world-up, not house-up) ─────────── */}
      <mesh ref={scanRef} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[planSize * 1.2, planSize * 1.2]} />
        <meshBasicMaterial color={glow} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* ─── Ground halo ─────────────────────────────────────────────── */}
      <mesh ref={haloRef} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[planSize * 0.55, planSize * 0.72, 64]} />
        <meshBasicMaterial color={glow} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
      </mesh>

    </group>
  );
}

// ─── Loaded GLB ────────────────────────────────────────────────────────────
// Trellis returns a free-form GLB at arbitrary scale and pivot. We center it
// on the origin and uniformly scale it so the longest XZ side matches the
// current footprint width — that keeps panels (placed by <Panels/> using the
// HouseGeometry footprint) aligned on the model's roof.

function LoadedGlb({
  url,
  width,
  depth,
  height,
  opacity = 1,
}: {
  url: string;
  width: number;
  depth: number;
  height: number;
  /** Multiplied into every mesh material's opacity for the morph fade-in. */
  opacity?: number;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const setGlbLoaded = useStore((s) => s.setGlbLoaded);
  const setGlbHeight = useStore((s) => s.setGlbHeight);
  const setGlbRoofAreaM2 = useStore((s) => s.setGlbRoofAreaM2);
  const setGlbBboxXZ = useStore((s) => s.setGlbBboxXZ);

  // Tell the rest of the app (Orchestrator → panel drop animation) that the
  // GLB is in the scene. Done here rather than on `trellisStatus === 'ready'`
  // because Trellis URL availability ≠ GLTF mesh visibility (Suspense fallback).
  useEffect(() => {
    setGlbLoaded(true);
    return () => {
      // When the URL changes (new run), reset the flag so the next pipeline
      // start doesn't see a stale `true`.
      setGlbLoaded(false);
      setGlbHeight(null);
    };
  }, [url, setGlbLoaded, setGlbHeight]);

  const { scale, offset, scaledHeight, scaledWidth, scaledDepth, roofAreaM2 } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const targetXZ = Math.max(width, depth);
    const sourceXZ = Math.max(size.x, size.z, 0.001);
    const s = targetXZ / sourceXZ;

    // Compute the upward-facing surface area of the GLB (= effective roof
    // surface). Sum triangles whose world-Y normal component > 0.5, with
    // the uniform scale factor `s` applied (linear → s², area → s²).
    let roofA = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const cross = new Vector3();
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry;
      if (!geom?.attributes?.position) return;
      const idx = geom.index;
      const pos = geom.attributes.position;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.array[t * 3] : t * 3;
        const i1 = idx ? idx.array[t * 3 + 1] : t * 3 + 1;
        const i2 = idx ? idx.array[t * 3 + 2] : t * 3 + 2;
        a.fromBufferAttribute(pos, i0);
        b.fromBufferAttribute(pos, i1);
        c.fromBufferAttribute(pos, i2);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        cross.crossVectors(ab, ac);
        const len = cross.length();
        if (len > 1e-9 && cross.y / len > 0.5) {
          roofA += len * 0.5;
        }
      }
    });
    // Scale linear dimensions by `s` ⇒ area scales by s².
    const roofAreaScaled = roofA * s * s;

    return {
      scale: s,
      // Recenter to origin on XZ, drop Y so the model sits on y=0.
      offset: new Vector3(-center.x * s, -box.min.y * s, -center.z * s),
      scaledHeight: size.y * s,
      scaledWidth: size.x * s,
      scaledDepth: size.z * s,
      roofAreaM2: roofAreaScaled,
    };
  }, [scene, width, depth]);

  // Publish the rendered roof height + footprint + roof area so downstream
  // consumers (HouseGeometryProvider, Panels packer, KPISidebar) can size
  // panels and coverage relative to the actual GLB.
  useEffect(() => {
    setGlbHeight(scaledHeight);
    setGlbBboxXZ({ width: scaledWidth, depth: scaledDepth });
    setGlbRoofAreaM2(roofAreaM2);
  }, [
    scaledHeight,
    scaledWidth,
    scaledDepth,
    roofAreaM2,
    setGlbHeight,
    setGlbBboxXZ,
    setGlbRoofAreaM2,
  ]);

  // One-shot post-load mesh prep: shadows + transparent materials (for the
  // skeleton→GLB cross-fade) + BVH on the geometry so downstream raycasts
  // in <Panels/> finish in milliseconds instead of freezing the tab.
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m && 'transparent' in m) m.transparent = true;
      }
      const geom = mesh.geometry as BvhAugmentedGeometry;
      if (geom.computeBoundsTree && !geom.boundsTree) {
        geom.computeBoundsTree();
      }
    });
    return () => {
      scene.traverse((obj) => {
        const geom = (obj as Mesh).geometry as BvhAugmentedGeometry | undefined;
        if (geom?.disposeBoundsTree) geom.disposeBoundsTree();
      });
    };
  }, [scene]);

  // Drive the opacity each frame (cheaper than a re-render on every step).
  useFrame(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m && 'opacity' in m) (m as { opacity: number }).opacity = opacity;
      }
    });
  });

  // Use the height from the house geometry only as a sanity check — Trellis
  // GLBs already encode their own roof height correctly relative to their
  // footprint, so we keep the uniform scale.
  void height;

  // The userData tag lets <Panels/> find the GLB root via scene.traverse so
  // it can raycast each panel's (X, Z) onto the actual roof surface.
  useEffect(() => {
    scene.userData.isGlbRoof = true;
  }, [scene]);

  return <primitive object={scene} scale={scale} position={offset} />;
}

function Ground() {
  return (
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#e7e2d9" roughness={0.95} />
    </mesh>
  );
}

