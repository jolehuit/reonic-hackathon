// 3D Scene root — OWNED by Dev A
// The building mesh is generated on-the-fly from the oblique aerial screenshot
// via fal-ai/trellis-2 (see TrellisModel.tsx + /api/trellis). The legacy
// procedural BuildingRenderer + SceneVisionProvider (OSM + Gemini Vision)
// chain is gone — it was eating the Gemini quota and the new pipeline is the
// /aerial flow.
//
// Accepts demo houses (brandenburg/hamburg/ruhr) AND `'custom'` for any
// address typed by the user — geometry comes from the store in that case.

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
import { HouseGeometryProvider } from './HouseGeometry';
import { TrellisModel } from './TrellisModel';
import { Panels } from './Panels';
import { Battery } from './Battery';
import { HeatPump } from './HeatPump';
import { Wallbox } from './Wallbox';
import { Inverter } from './Inverter';
import type { HouseId } from '@/lib/types';

interface Props {
  houseId: HouseId | 'custom';
}

export function Scene3D({ houseId }: Props) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as unknown as { __store?: typeof useStore };
    w.__store = useStore;
  }, []);

  const isDemoHouse = houseId !== 'custom';

  return (
    <>
      {isDemoHouse && <DevMockProvider houseId={houseId} />}
      <HouseGeometryProvider houseId={houseId}>
        <ProceduralCanvas houseId={houseId} />
      </HouseGeometryProvider>
    </>
  );
}

function ProceduralCanvas({ houseId }: { houseId: HouseId | 'custom' }) {
  const refinements = useStore((s) => s.refinements);
  const design = useStore((s) => s.design);
  const phase = useStore((s) => s.phase);
  const panelEditMode = useStore((s) => s.panelEditMode);
  const showComponents =
    phase === 'interactive' || phase === 'reviewing' || phase === 'approved';

  return (
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

        <TrellisModel />
        <Panels />
        {showComponents && design && (
          <>
            {refinements.includeBattery && design.batteryCapacityKwh && <Battery />}
            {refinements.includeHeatPump && design.heatPumpModel && <HeatPump />}
            {refinements.includeWallbox && design.wallboxChargeSpeedKw && <Wallbox />}
            <Inverter />
          </>
        )}

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
        // In panel-edit mode the user clicks/drags panels and clicks bare
        // roof to add — orbit + zoom would steal those gestures, so we lock
        // panning/rotation while editing. Wheel zoom stays enabled so the
        // user can still close in on a tight roof.
        enableRotate={!panelEditMode}
        enablePan={!panelEditMode}
      />

      <EffectComposer multisampling={4} enableNormalPass={false}>
        <Bloom intensity={0.06} luminanceThreshold={0.95} luminanceSmoothing={0.25} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  );
}
