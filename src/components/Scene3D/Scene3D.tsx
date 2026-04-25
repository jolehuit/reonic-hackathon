// 3D Scene root — OWNED by Dev A
// Loads house GLB + lighting + post-processing + camera rig.

'use client';

import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Suspense } from 'react';
import { House } from './House';
import { Sun } from './Sun';
// import { Panels } from './Panels';
// import { Inverter } from './Inverter';
// import { Battery } from './Battery';
// import { HeatPump } from './HeatPump';
// import { Wallbox } from './Wallbox';
// import { Heatmap } from './Heatmap';
// import { CameraRig } from './CameraRig';
import type { HouseId } from '@/lib/types';

interface Props {
  houseId: HouseId;
}

export function Scene3D({ houseId }: Props) {
  return (
    <Canvas
      shadows
      camera={{ position: [40, 30, 40], fov: 35 }}
      gl={{ antialias: true, toneMappingExposure: 1.1 }}
    >
      <Suspense fallback={null}>
        <Environment preset="sunset" background={false} />
        <Sun />
        <House houseId={houseId} />
        {/* TODO Dev A: <Panels /> <Inverter /> <Battery /> <HeatPump /> <Wallbox /> <Heatmap /> */}
      </Suspense>
      <OrbitControls makeDefault enableDamping />
      {/* TODO Dev A: replace OrbitControls with <CameraRig /> for cinematic dive */}
      {/* TODO Dev A: <EffectComposer> <Bloom /> <ToneMapping mode={ACESFilmic} /> </EffectComposer> */}
    </Canvas>
  );
}
