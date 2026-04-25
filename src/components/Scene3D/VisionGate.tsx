// Render gate driven by the Gemini Vision pipeline status — OWNED by Dev A
// While the AI is still analyzing the captures, we show a minimal wireframe
// placeholder of the building footprint so the scene isn't empty. As soon as
// Gemini responds (or fails / runs idle), we hand off to the full procedural
// model. This makes the AI's contribution visible and avoids the impression
// that the model exists before the AI has actually generated it.

'use client';

import type { ReactNode } from 'react';
import { Edges } from '@react-three/drei';
import { useSceneVision } from './vision/useSceneVision';
import { useHouseGeometry } from './HouseGeometry';

interface Props {
  children: ReactNode;
}

export function VisionGate({ children }: Props) {
  const { status } = useSceneVision();
  if (status.kind === 'loading') {
    return <LoadingPlaceholder />;
  }
  return <>{children}</>;
}

function LoadingPlaceholder() {
  const { width, depth, wallHeight } = useHouseGeometry();
  // Show only the ground plane + a wireframe of the bounding volume — clearly
  // "under construction" by the AI. No fenestration, no roof, no components.
  return (
    <group>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshToonMaterial color="#fafafa" />
      </mesh>
      <mesh position={[0, wallHeight / 2, 0]}>
        <boxGeometry args={[width, wallHeight, depth]} />
        <meshBasicMaterial color="#cfcfcf" transparent opacity={0.08} />
        <Edges threshold={15} color="#666666" lineWidth={1.5} />
      </mesh>
    </group>
  );
}
