// 3D Scene root — OWNED by Dev A
// Architectural mockup: cream toon volume + crisp black edges, soft diffuse light.
//
// Source switcher (URL ?source=...):
//   gemini  → Gemini Vision only (BuildingRenderer)
//   osm     → OSM cadastral footprint + Gemini Vision details (BuildingRenderer)
//   tiles   → Google Photorealistic 3D Tiles (Tiles3DRenderer, no AI)

'use client';

import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { NoToneMapping } from 'three';
import { Suspense, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Sun } from './Sun';
import { CameraRig } from './CameraRig';
import { DevMockProvider } from './DevMockProvider';
import { HouseGeometryProvider, useHouseGeometry } from './HouseGeometry';
import { SceneVisionProvider } from './vision/useSceneVision';
import { VisionStatusBadge } from './VisionStatusBadge';
import { VisionGate } from './VisionGate';
import { BuildingRenderer } from './BuildingRenderer';
import { Tiles3DRenderer, type ClipPolygon } from './Tiles3DRenderer';
import { useSceneSource, type SceneSource } from './vision/useSceneSource';
import { HOUSE_COORDS } from './vision/houseLatLng';
import type { HouseId } from '@/lib/types';
import type { AnalysisMode } from './vision/sceneVisionAction';

interface Props {
  houseId: HouseId;
}

const SOURCE_TO_MODE: Record<SceneSource, AnalysisMode | null> = {
  gemini: 'gemini',
  osm: 'osm-hybrid',
  tiles: null, // Tiles bypasses the vision action entirely
};

export function Scene3D({ houseId }: Props) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as unknown as { __store?: typeof useStore };
    w.__store = useStore;
  }, []);

  const source = useSceneSource();

  if (source === 'tiles') {
    return <TilesScene houseId={houseId} />;
  }

  return <ProceduralScene houseId={houseId} mode={SOURCE_TO_MODE[source] as AnalysisMode} />;
}

// ─── Procedural scene (gemini OR osm-hybrid) ──────────────────────────────

function ProceduralScene({ houseId, mode }: { houseId: HouseId; mode: AnalysisMode }) {
  return (
    <>
      <DevMockProvider houseId={houseId} />
      <HouseGeometryProvider houseId={houseId}>
        <ProceduralCanvas houseId={houseId} mode={mode} />
      </HouseGeometryProvider>
    </>
  );
}

function ProceduralCanvas({ houseId, mode }: { houseId: HouseId; mode: AnalysisMode }) {
  const { analysis } = useHouseGeometry();
  return (
    <SceneVisionProvider houseId={houseId} analysis={analysis} mode={mode}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [13, 8, 13], fov: 38 }}
        gl={{
          antialias: true,
          toneMapping: NoToneMapping,
        }}
        style={{
          background:
            'linear-gradient(180deg, #eef3f8 0%, #f6f1ea 60%, #f0e6d6 100%)',
        }}
      >
        <Suspense fallback={null}>
          <Environment preset="apartment" background={false} environmentIntensity={0.2} />
          <ambientLight intensity={0.55} />
          <Sun />

          <VisionGate>
            <BuildingRenderer />
          </VisionGate>

          <ContactShadows
            position={[0, 0.005, 0]}
            opacity={0.32}
            scale={16}
            blur={2}
            far={6}
            color="#1a1a1a"
          />
        </Suspense>

        <CameraRig />
        <OrbitControls
          makeDefault
          enableDamping
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={6}
          maxDistance={40}
        />

        <EffectComposer multisampling={4} enableNormalPass={false}>
          <Bloom intensity={0.06} luminanceThreshold={0.95} luminanceSmoothing={0.25} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <VisionStatusBadge />
    </SceneVisionProvider>
  );
}

// ─── 3D Tiles scene (raw photogrammetric mesh, no AI) ─────────────────────

function TilesScene({ houseId }: { houseId: HouseId }) {
  const coords = HOUSE_COORDS[houseId];
  const explicit = readExplicitFromUrl();
  const clipPolygon = readClipPolygonFromUrl();
  return (
    <>
      <DevMockProvider houseId={houseId} />
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 1.5e7], fov: 50, near: 1, far: 1e9 }}
        gl={{ antialias: true, logarithmicDepthBuffer: true, localClippingEnabled: true }}
        style={{ background: '#0a0a0a' }}
      >
        <Suspense fallback={null}>
          {explicit ? (
            <Tiles3DRenderer
              mode="explicit"
              cameraLat={explicit.cameraLat}
              cameraLng={explicit.cameraLng}
              cameraAlt={explicit.cameraAlt}
              targetLat={explicit.targetLat}
              targetLng={explicit.targetLng}
              targetAlt={explicit.targetAlt}
              fov={explicit.fov}
              lockCamera={readLockFromUrl()}
              clipPolygon={clipPolygon ?? undefined}
            />
          ) : (
            <Tiles3DRenderer
              lat={coords.lat}
              lng={coords.lng}
              azimuth={readAzimuthFromUrl()}
              lockCamera={readLockFromUrl()}
              clipPolygon={clipPolygon ?? undefined}
            />
          )}
        </Suspense>
      </Canvas>
      <SourceIndicator label="Google 3D Tiles · photogrammetric mesh" />
    </>
  );
}

// URL helpers for the capture script. ?azimuth=180 sets the camera angle;
// ?lock=1 disables interactive controls so screenshots stay deterministic.
function readAzimuthFromUrl(): number {
  if (typeof window === 'undefined') return 180;
  const v = new URLSearchParams(window.location.search).get('azimuth');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 180;
}

function readLockFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('lock') === '1';
}

interface ExplicitCameraParams {
  cameraLat: number;
  cameraLng: number;
  cameraAlt: number;
  targetLat: number;
  targetLng: number;
  targetAlt: number;
  fov?: number;
}

function readClipPolygonFromUrl(): ClipPolygon | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('clip');
  if (!v) return null;
  try {
    const json = atob(v);
    const parsed = JSON.parse(json) as ClipPolygon;
    if (!Array.isArray(parsed.vertices) || parsed.vertices.length < 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readExplicitFromUrl(): ExplicitCameraParams | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null) return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const cameraLat = num('clat');
  const cameraLng = num('clng');
  const cameraAlt = num('calt');
  const targetLat = num('tlat');
  const targetLng = num('tlng');
  const targetAlt = num('talt');
  if ([cameraLat, cameraLng, cameraAlt, targetLat, targetLng, targetAlt].some(Number.isNaN)) {
    return null;
  }
  const fov = num('fov');
  return {
    cameraLat,
    cameraLng,
    cameraAlt,
    targetLat,
    targetLng,
    targetAlt,
    fov: Number.isNaN(fov) ? undefined : fov,
  };
}

function SourceIndicator({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-4 bottom-24 z-30 rounded-lg border border-zinc-700 bg-zinc-900/85 px-3 py-2 font-mono text-xs text-zinc-100 shadow-lg">
      <span className="font-semibold">Source:</span> <span className="text-zinc-300">{label}</span>
    </div>
  );
}
