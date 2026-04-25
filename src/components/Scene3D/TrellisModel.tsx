// Image-to-3D house model via fal-ai/trellis-2.
// Replaces the procedural BuildingRenderer for the new aerial-driven flow:
// triggers /api/trellis on mount, shows an animated wireframe skeleton until
// the GLB is back, then loads & rescales it to fit the existing footprint
// (so the panels mounted by <Panels/> still align).

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import { Box3, Group, Mesh, Vector3 } from 'three';
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

export function TrellisModel({ houseId }: { houseId: HouseId | 'custom' }) {
  const coords = useResolvedCoords(houseId);
  const { width, depth, wallHeight } = useHouseGeometry();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Trigger /api/trellis whenever lat/lng changes. The route is sync (~30-60s)
  // so we just await the JSON; the skeleton animates while we wait.
  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    const startedAt = Date.now();
    setStatus({ kind: 'generating', sinceMs: startedAt });

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
          return;
        }
        setStatus({ kind: 'ready', glbUrl: json.glbUrl });
      } catch (err) {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'network error',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lng, houseId]);

  return (
    <group>
      <Ground />
      {status.kind === 'ready' ? (
        <Suspense fallback={<Skeleton width={width} depth={depth} height={wallHeight} />}>
          <LoadedGlb url={status.glbUrl} width={width} depth={depth} height={wallHeight} />
        </Suspense>
      ) : (
        <Skeleton
          width={width}
          depth={depth}
          height={wallHeight}
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
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Pulse opacity 0.18 → 0.4 → 0.18 over ~2s.
    const pulse = 0.29 + Math.sin(t * 3) * 0.11;
    const mat = meshRef.current?.material;
    if (mat && 'opacity' in mat) {
      (mat as { opacity: number }).opacity = pulse;
    }
    // Slow yaw rotation so it doesn't feel frozen.
    if (groupRef.current) groupRef.current.rotation.y = t * 0.12;
  });

  const color = tone === 'error' ? '#dc2626' : '#3b82f6';

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} position={[0, height / 2, 0]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} wireframe={false} depthWrite={false} />
        <Edges color={color} threshold={1} />
      </mesh>
      {/* Pyramidal "roof" hint so the skeleton reads as a house. */}
      <mesh position={[0, height + (height * 0.35) / 2, 0]}>
        <coneGeometry args={[Math.max(width, depth) * 0.6, height * 0.35, 4]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
        <Edges color={color} threshold={1} />
      </mesh>
      {message && (
        <Html
          position={[0, height + height * 0.6, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div className={tone === 'error' ? 'tm-badge tm-badge-error' : 'tm-badge tm-badge-busy'}>
            <span className="tm-dot" />
            {message}
            {tone === 'busy' && <span className="tm-ellipsis" />}
          </div>
          <style>{`
            .tm-badge {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              border-radius: 999px;
              font: 500 12px/1 system-ui, -apple-system, sans-serif;
              white-space: nowrap;
              backdrop-filter: blur(6px);
              -webkit-backdrop-filter: blur(6px);
              box-shadow: 0 4px 14px rgba(0,0,0,0.12);
            }
            .tm-badge-busy {
              color: #1e3a8a;
              background: rgba(255,255,255,0.85);
              border: 1px solid rgba(59,130,246,0.4);
            }
            .tm-badge-error {
              color: #991b1b;
              background: rgba(255,255,255,0.9);
              border: 1px solid rgba(220,38,38,0.5);
            }
            .tm-dot {
              width: 8px;
              height: 8px;
              border-radius: 999px;
              background: currentColor;
              animation: tm-pulse 1.2s ease-in-out infinite;
            }
            .tm-ellipsis::after {
              content: '';
              display: inline-block;
              width: 0;
              animation: tm-dots 1.4s steps(4, end) infinite;
              overflow: hidden;
              vertical-align: bottom;
            }
            @keyframes tm-pulse {
              0%, 100% { opacity: 0.35; transform: scale(0.85); }
              50%      { opacity: 1;    transform: scale(1.15); }
            }
            @keyframes tm-dots {
              0%   { content: ''; width: 0; }
              25%  { content: '.'; width: 0.45em; }
              50%  { content: '..'; width: 0.9em; }
              75%  { content: '...'; width: 1.35em; }
              100% { content: '...'; width: 1.35em; }
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
