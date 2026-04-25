// Image-to-3D house model via fal-ai/trellis-2.
// Replaces the procedural BuildingRenderer for the new aerial-driven flow:
// triggers /api/trellis on mount, shows an animated wireframe skeleton until
// the GLB is back, then loads & rescales it to fit the existing footprint
// (so the panels mounted by <Panels/> still align).

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Edges, Html, Billboard } from '@react-three/drei';
import { Box3, Group, Mesh, Shape, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { HOUSE_COORDS } from './vision/houseLatLng';
import type { HouseId } from '@/lib/types';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating'; sinceMs: number }
  | { kind: 'ready'; glbUrl: string }
  | { kind: 'error'; message: string };

// Aesthetic skeleton dimensions — keep the placeholder tall and house-shaped
// regardless of the eventual footprint (which can be wide/squat for some demo
// houses and would render as a flat slab). The GLB replaces this once ready,
// at which point its real footprint determines the size.
const SKELETON_WIDTH = 4;
const SKELETON_DEPTH = 4.4;
const SKELETON_WALL = 3.5;

export function TrellisModel({ houseId }: { houseId: HouseId | 'custom' }) {
  const coords = useResolvedCoords(houseId);
  const { width, depth, wallHeight } = useHouseGeometry();
  const setTrellisStatus = useStore((s) => s.setTrellisStatus);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Trigger /api/trellis whenever lat/lng changes. The route is sync (~30-60s)
  // so we just await the JSON; the skeleton animates while we wait. We also
  // mirror the status into the Zustand store so the design page overlays
  // (KPISidebar, ControlPanel, …) and the Orchestrator can gate on it.
  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    const startedAt = Date.now();
    setStatus({ kind: 'generating', sinceMs: startedAt });
    setTrellisStatus('generating');

    (async () => {
      try {
        const res = await fetch('/api/trellis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
        });
        const json = (await res.json()) as { ok: boolean; glbUrl?: string; error?: string };
        if (cancelled) return;
        if (!json.ok || !json.glbUrl) {
          setStatus({ kind: 'error', message: json.error ?? 'Generation failed' });
          setTrellisStatus('error');
          return;
        }
        setStatus({ kind: 'ready', glbUrl: json.glbUrl });
        setTrellisStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'network error',
        });
        setTrellisStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lng, houseId, setTrellisStatus]);

  // Screenshot URL (the same oblique screenshot fal will analyze) — fetched
  // in parallel by the browser as a TextureLoader so we can show it as a
  // backdrop while waiting. Browser cache means /api/aerial only runs once
  // even though /api/trellis also pulls it server-side.
  const screenshotUrl = coords
    ? `/api/aerial?lat=${coords.lat}&lng=${coords.lng}&zoom=20&tilted=1`
    : null;

  return (
    <group>
      <Ground />
      {screenshotUrl && status.kind !== 'idle' && (
        <Suspense fallback={null}>
          <ScreenshotBillboard
            url={screenshotUrl}
            // Fade out once GLB is ready (we'll cross-fade through the morph).
            isReady={status.kind === 'ready'}
          />
        </Suspense>
      )}
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
  const MORPH_MS = 1500;

  useEffect(() => {
    if (status.kind === 'ready' && transitionStartedRef.current === null) {
      transitionStartedRef.current = performance.now();
    }
  }, [status.kind]);

  useFrame(() => {
    if (transitionStartedRef.current === null) return;
    const elapsed = performance.now() - transitionStartedRef.current;
    const t = Math.min(1, elapsed / MORPH_MS);
    if (t !== transitionT) setTransitionT(t);
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
            message={
              status.kind === 'generating'
                ? 'Generating 3D model'
                : status.kind === 'error'
                ? `Failed: ${status.message}`
                : status.kind === 'ready'
                ? undefined
                : 'Preparing'
            }
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

// Screenshot of the oblique aerial view (Cesium + 3D Tiles) shown as a
// billboard always facing the camera. Fades in once the texture loads,
// fades out when the GLB is ready so the eye is drawn back to the model.
function ScreenshotBillboard({ url, isReady }: { url: string; isReady: boolean }) {
  const texture = useLoader(TextureLoader, url);
  const meshRef = useRef<Mesh>(null);
  const fadeStartRef = useRef<number>(performance.now());

  useFrame(() => {
    const mat = meshRef.current?.material as { opacity?: number } | undefined;
    if (!mat) return;
    const elapsed = performance.now() - fadeStartRef.current;
    if (isReady) {
      // Fade out over 800ms once GLB is ready.
      mat.opacity = Math.max(0, 0.55 * (1 - elapsed / 800));
    } else {
      // Fade in over 600ms after texture loaded.
      mat.opacity = Math.min(0.55, (elapsed / 600) * 0.55);
    }
  });

  // Reset fade timer when isReady flips.
  useEffect(() => {
    fadeStartRef.current = performance.now();
  }, [isReady]);

  // Aspect ratio from the texture (most Cesium screenshots are square ~1280x1280).
  const aspect = (texture.image?.width ?? 1) / (texture.image?.height ?? 1);
  const W = 9;
  const H = W / aspect;

  return (
    <Billboard position={[0, 5, -7]} follow lockX={false} lockY={false} lockZ={false}>
      <mesh ref={meshRef}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

// ─── Skeleton (in-canvas) ───────────────────────────────────────────────────
// Wireframe box pulsing in opacity so the user always sees "something is
// happening" — even before /api/trellis returns. A small <Html> badge floats
// above with the current status text.

function Skeleton({
  width,
  depth,
  height,
  message,
  tone = 'busy',
  opacityMul = 1,
}: {
  width: number;
  depth: number;
  height: number;
  message?: string;
  tone?: 'busy' | 'error';
  /** Multiplies all rendered material opacities (used during morph fade-out). */
  opacityMul?: number;
}) {
  const houseRef = useRef<Group>(null);
  const wallsRef = useRef<Mesh>(null);
  const roofRef = useRef<Mesh>(null);
  const scanRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);
  const startedAt = useRef<number>(performance.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (tone !== 'busy') return;
    const id = setInterval(() => {
      setElapsedSec(Math.floor((performance.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [tone]);

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

      {/* ─── Floating badge — fixed pixel size, sits well above model ── */}
      {message && (
        <Html
          position={[0, totalH * 1.7, 0]}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[16777271, 16777271]}
        >
          <div className={tone === 'error' ? 'tm-card tm-card-error' : 'tm-card tm-card-busy'}>
            <div className="tm-card-bg" />
            <div className="tm-card-inner">
              <div className="tm-orb">
                <span className="tm-orb-core" />
                <span className="tm-orb-ring tm-orb-ring-1" />
                <span className="tm-orb-ring tm-orb-ring-2" />
              </div>
              <div className="tm-text">
                <div className="tm-title">
                  <span className="tm-title-text">{message}</span>
                  {tone === 'busy' && <span className="tm-ellipsis" />}
                </div>
                {tone === 'busy' && (
                  <div className="tm-sub">
                    <span className="tm-bars">
                      <span /><span /><span /><span /><span />
                    </span>
                    <span className="tm-elapsed">
                      {elapsedSec}s elapsed · usually ~45s
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <style>{`
            .tm-card {
              position: relative;
              padding: 22px 34px;
              border-radius: 22px;
              font: 600 22px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
              white-space: nowrap;
              backdrop-filter: blur(18px) saturate(150%);
              -webkit-backdrop-filter: blur(18px) saturate(150%);
              overflow: hidden;
              box-shadow:
                0 1px 0 rgba(255,255,255,0.7) inset,
                0 20px 50px rgba(15,23,42,0.22),
                0 4px 14px rgba(15,23,42,0.12);
              transform: translateZ(0);
            }
            .tm-card-busy {
              color: #0c1f5a;
              background: linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(241,245,255,0.92) 100%);
              border: 1px solid rgba(59,130,246,0.35);
            }
            .tm-card-error {
              color: #7f1d1d;
              background: linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(254,242,242,0.95) 100%);
              border: 1px solid rgba(220,38,38,0.45);
            }
            /* Animated shimmer streaking diagonally across the card */
            .tm-card-bg {
              position: absolute;
              inset: 0;
              pointer-events: none;
              background: linear-gradient(
                115deg,
                transparent 30%,
                rgba(96,165,250,0.22) 48%,
                rgba(96,165,250,0.08) 52%,
                transparent 70%
              );
              background-size: 220% 100%;
              animation: tm-shimmer 2.6s linear infinite;
              mix-blend-mode: screen;
            }
            .tm-card-error .tm-card-bg {
              background: linear-gradient(
                115deg,
                transparent 30%,
                rgba(248,113,113,0.22) 48%,
                rgba(248,113,113,0.08) 52%,
                transparent 70%
              );
              background-size: 220% 100%;
              animation: tm-shimmer 2.6s linear infinite;
            }
            .tm-card-inner {
              position: relative;
              display: flex;
              align-items: center;
              gap: 18px;
            }
            .tm-text {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .tm-title {
              display: inline-flex;
              align-items: baseline;
              font-size: 28px;
              letter-spacing: -0.015em;
              font-weight: 700;
            }
            .tm-title-text {
              background: linear-gradient(90deg, currentColor 0%, currentColor 35%, #2563eb 50%, currentColor 65%, currentColor 100%);
              background-size: 200% 100%;
              -webkit-background-clip: text;
              background-clip: text;
              -webkit-text-fill-color: transparent;
              animation: tm-text-shine 2.6s linear infinite;
            }
            .tm-card-error .tm-title-text {
              -webkit-text-fill-color: currentColor;
              background: none;
              animation: none;
            }
            .tm-sub {
              display: inline-flex;
              align-items: center;
              gap: 12px;
              font-size: 14px;
              font-weight: 500;
              opacity: 0.7;
            }
            .tm-elapsed {
              font-variant-numeric: tabular-nums;
            }
            /* Equalizer-style bars (5 of them) */
            .tm-bars {
              display: inline-flex;
              align-items: flex-end;
              gap: 3px;
              height: 16px;
            }
            .tm-bars span {
              width: 4px;
              border-radius: 2px;
              background: currentColor;
              opacity: 0.85;
              animation: tm-bar 1.1s ease-in-out infinite;
            }
            .tm-bars span:nth-child(1) { animation-delay: 0.0s;  }
            .tm-bars span:nth-child(2) { animation-delay: 0.12s; }
            .tm-bars span:nth-child(3) { animation-delay: 0.24s; }
            .tm-bars span:nth-child(4) { animation-delay: 0.36s; }
            .tm-bars span:nth-child(5) { animation-delay: 0.48s; }
            @keyframes tm-bar {
              0%, 100% { height: 30%; }
              50%      { height: 100%; }
            }
            /* Orb on the left: solid core + two expanding rings */
            .tm-orb {
              position: relative;
              width: 42px;
              height: 42px;
              flex-shrink: 0;
            }
            .tm-orb-core {
              position: absolute;
              inset: 12px;
              border-radius: 999px;
              background: radial-gradient(circle at 35% 30%, #93c5fd, #2563eb 70%);
              box-shadow: 0 0 18px rgba(37,99,235,0.6);
              animation: tm-orb-pulse 1.4s ease-in-out infinite;
            }
            .tm-card-error .tm-orb-core {
              background: radial-gradient(circle at 35% 30%, #fca5a5, #b91c1c 70%);
              box-shadow: 0 0 12px rgba(185,28,28,0.55);
            }
            .tm-orb-ring {
              position: absolute;
              inset: 0;
              border-radius: 999px;
              border: 2px solid rgba(37,99,235,0.6);
              animation: tm-orb-ring 2s ease-out infinite;
            }
            .tm-orb-ring-2 { animation-delay: 1s; }
            .tm-card-error .tm-orb-ring { border-color: rgba(185,28,28,0.6); }
            @keyframes tm-orb-pulse {
              0%, 100% { transform: scale(0.92); opacity: 0.85; }
              50%      { transform: scale(1.08); opacity: 1;    }
            }
            @keyframes tm-orb-ring {
              0%   { transform: scale(0.55); opacity: 0.85; }
              80%  { opacity: 0; }
              100% { transform: scale(1.6);  opacity: 0; }
            }
            .tm-ellipsis::after {
              content: '';
              display: inline-block;
              width: 1.4em;
              text-align: left;
              animation: tm-dots 1.4s steps(4, end) infinite;
              vertical-align: bottom;
              padding-left: 2px;
            }
            @keyframes tm-dots {
              0%   { content: ''; }
              25%  { content: '.'; }
              50%  { content: '..'; }
              75%, 100% { content: '...'; }
            }
            @keyframes tm-shimmer {
              0%   { background-position: 100% 0; }
              100% { background-position: -100% 0; }
            }
            @keyframes tm-text-shine {
              0%   { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
          `}</style>
        </Html>
      )}
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

  const { scale, offset } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const targetXZ = Math.max(width, depth);
    const sourceXZ = Math.max(size.x, size.z, 0.001);
    const s = targetXZ / sourceXZ;
    return {
      scale: s,
      // Recenter to origin on XZ, drop Y so the model sits on y=0.
      offset: new Vector3(-center.x * s, -box.min.y * s, -center.z * s),
    };
  }, [scene, width, depth]);

  // Cast/receive shadows on every mesh + flip materials transparent so the
  // opacity fade-in works during the morph.
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
    });
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

// ─── Resolve current address ───────────────────────────────────────────────

function useResolvedCoords(houseId: HouseId | 'custom'): { lat: number; lng: number } | null {
  const customAddress = useStore((s) => s.customAddress);
  return useMemo(() => {
    if (houseId === 'custom') {
      return customAddress ? { lat: customAddress.lat, lng: customAddress.lng } : null;
    }
    const c = HOUSE_COORDS[houseId];
    return c ? { lat: c.lat, lng: c.lng } : null;
  }, [houseId, customAddress]);
}
