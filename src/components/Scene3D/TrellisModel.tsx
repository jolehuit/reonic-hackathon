// Image-to-3D house model via fal-ai/trellis-2.
// Replaces the procedural BuildingRenderer for the new aerial-driven flow:
// triggers /api/trellis on mount, shows an animated wireframe skeleton until
// the GLB is back, then loads & rescales it to fit the existing footprint
// (so the panels mounted by <Panels/> still align).

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import { Box3, Group, Mesh, Shape, Vector3 } from 'three';
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

  return (
    <group>
      <Ground />
      {status.kind === 'ready' ? (
        <Suspense
          fallback={
            <Skeleton width={SKELETON_WIDTH} depth={SKELETON_DEPTH} height={SKELETON_WALL} />
          }
        >
          <LoadedGlb url={status.glbUrl} width={width} depth={depth} height={wallHeight} />
        </Suspense>
      ) : (
        <Skeleton
          width={SKELETON_WIDTH}
          depth={SKELETON_DEPTH}
          height={SKELETON_WALL}
          message={
            status.kind === 'generating'
              ? 'Generating 3D model'
              : status.kind === 'error'
              ? `Failed: ${status.message}`
              : 'Preparing'
          }
          tone={status.kind === 'error' ? 'error' : 'busy'}
        />
      )}
    </group>
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
}: {
  width: number;
  depth: number;
  height: number;
  message?: string;
  tone?: 'busy' | 'error';
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
    // Walls + roof: gentle opacity pulse on the wireframe edges.
    const pulse = 0.55 + Math.sin(t * 2.5) * 0.25;
    const wallsMat = wallsRef.current?.material as { opacity?: number } | undefined;
    if (wallsMat && 'opacity' in wallsMat) wallsMat.opacity = pulse;
    const roofMat = roofRef.current?.material as { opacity?: number } | undefined;
    if (roofMat && 'opacity' in roofMat) roofMat.opacity = pulse;

    // Scan plane sweeping bottom→top→bottom over ~3s.
    if (scanRef.current) {
      const phase = (Math.sin(t * 1.0) + 1) * 0.5;
      scanRef.current.position.y = phase * totalH;
      const mat = scanRef.current.material as { opacity?: number } | undefined;
      if (mat && 'opacity' in mat) mat.opacity = 0.6 - Math.abs(phase - 0.5) * 0.5;
    }
    // Halo at the ground — slow expand/contract.
    if (haloRef.current) {
      const breath = 1 + (Math.sin(t * 1.6) + 1) * 0.18;
      haloRef.current.scale.set(breath, breath, breath);
      const mat = haloRef.current.material as { opacity?: number } | undefined;
      if (mat && 'opacity' in mat) mat.opacity = 0.32 - (Math.sin(t * 1.6) + 1) * 0.1;
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
}: {
  url: string;
  width: number;
  depth: number;
  height: number;
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

  // Cast/receive shadows on every mesh.
  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).castShadow = true;
        (obj as Mesh).receiveShadow = true;
      }
    });
  }, [scene]);

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
