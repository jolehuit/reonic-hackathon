// Solar panels — OWNED by Dev A
// InstancedMesh PBR (verre bleu profond + frame alu).
// Animated drop with bounce easing during agent run.

'use client';

import { useRef } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { useStore } from '@/lib/store';

export function Panels() {
  const design = useStore((s) => s.design);

  if (!design || design.modulePositions.length === 0) return null;

  // TODO Dev A:
  // - PBR material: dark blue glass + alu frame
  // - Drop animation: each panel falls from y+5 with 80ms stagger
  // - Bounce easing on landing
  // - Click handler to remove (optional, low priority per PRD)

  return (
    <Instances>
      <boxGeometry args={[1.7, 0.04, 1.0]} />
      <meshStandardMaterial color="#1a3a6e" metalness={0.6} roughness={0.2} />
      {design.modulePositions.map((p, i) => (
        <Instance key={i} position={[p.x, p.y, p.z]} />
      ))}
    </Instances>
  );
}
