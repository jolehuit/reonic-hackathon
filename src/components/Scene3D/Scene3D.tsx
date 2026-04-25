// 3D Scene root — OWNED by Dev A
// Architectural mockup: cream toon volume + crisp black edges, soft diffuse light.
//
// Source switcher (URL ?source=...):
//   gemini  → Gemini Vision only (BuildingRenderer)
//   osm     → OSM cadastral footprint + Gemini Vision details (BuildingRenderer, default)
//
// Accepts demo houses (brandenburg/hamburg/ruhr) AND `'custom'` for any
// address typed by the user — geometry comes from the store in that case.

'use client';

import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { NoToneMapping } from 'three';
import { Suspense, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Sun } from './Sun';
import { CameraRig } from './CameraRig';
import { DevMockProvider } from './DevMockProvider';
import { HouseGeometryProvider, useHouseGeometry } from './HouseGeometry';
import { SceneVisionProvider } from './vision/useSceneVision';
import { VisionStatusBadge } from './VisionStatusBadge';
import { VisionGate } from './VisionGate';
import { BuildingRenderer } from './BuildingRenderer';
import { Panels } from './Panels';
import { Battery } from './Battery';
import { HeatPump } from './HeatPump';
import { Wallbox } from './Wallbox';
import { Inverter } from './Inverter';
import { useSceneSource } from './vision/useSceneSource';
import type { HouseId } from '@/lib/types';
import type { AnalysisMode } from './vision/sceneVisionAction';

interface Props {
  houseId: HouseId | 'custom';
}

export function Scene3D({ houseId }: Props) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as unknown as { __store?: typeof useStore };
    w.__store = useStore;
  }, []);

  const source = useSceneSource();
  const mode: AnalysisMode = source === 'gemini' ? 'gemini' : 'osm-hybrid';

  const isDemoHouse = houseId !== 'custom';

  return (
    <>
      {isDemoHouse && <DevMockProvider houseId={houseId} />}
      <HouseGeometryProvider houseId={houseId}>
        <ProceduralCanvas houseId={houseId} mode={mode} />
      </HouseGeometryProvider>
    </>
  );
}

function ProceduralCanvas({
  houseId,
  mode,
}: {
  houseId: HouseId | 'custom';
  mode: AnalysisMode;
}) {
  const { analysis } = useHouseGeometry();
  const refinements = useStore((s) => s.refinements);
  const design = useStore((s) => s.design);
  const phase = useStore((s) => s.phase);
  const customAddress = useStore((s) => s.customAddress);
  const showComponents =
    phase === 'interactive' || phase === 'reviewing' || phase === 'approved';

  // SceneVisionProvider needs a HouseId for cache-key purposes — for custom we
  // pass `brandenburg` as a placeholder and override coordinates explicitly.
  const visionHouseId: HouseId = houseId === 'custom' ? 'brandenburg' : houseId;
  const coordsOverride = useMemo(() => {
    if (houseId !== 'custom' || !customAddress) return null;
    return {
      lat: customAddress.lat,
      lng: customAddress.lng,
      address: customAddress.formatted,
    };
  }, [houseId, customAddress]);

  return (
    <SceneVisionProvider
      houseId={visionHouseId}
      analysis={analysis}
      mode={mode}
      coordsOverride={coordsOverride}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [13, 8, 13], fov: 38 }}
        gl={{ antialias: true, toneMapping: NoToneMapping }}
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
            <Panels />
            {showComponents && design && (
              <>
                {refinements.includeBattery && design.batteryCapacityKwh && <Battery />}
                {refinements.includeHeatPump && design.heatPumpModel && <HeatPump />}
                {refinements.includeWallbox && design.wallboxChargeSpeedKw && <Wallbox />}
                <Inverter />
              </>
            )}
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
