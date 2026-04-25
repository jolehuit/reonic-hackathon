'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Center, Bounds } from '@react-three/drei';
import type { HouseId } from '@/lib/types';

interface Props {
  houseId: string;
}

export function GeneratedHouseViewer({ houseId }: Props) {
  const url = `/baked/${houseId as HouseId}-generated-latest.glb?ts=${Date.now()}`;

  return (
    <div className="absolute inset-0 bg-white">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [40, 30, 40], fov: 35, near: 0.1, far: 1000 }}
        shadows
      >
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[20, 30, 15]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.5}>
            <Center>
              <HouseModel url={url} />
            </Center>
          </Bounds>
          <Environment preset="city" />
        </Suspense>
        <gridHelper args={[80, 80, '#d4d4d8', '#e5e7eb']} position={[0, -0.001, 0]} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={5}
          maxDistance={200}
          maxPolarAngle={Math.PI / 2 - 0.05}
          makeDefault
        />
      </Canvas>
    </div>
  );
}

function HouseModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} castShadow receiveShadow />;
}

useGLTF.preload('/baked/brandenburg-generated-latest.glb');
