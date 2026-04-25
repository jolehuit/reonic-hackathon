// Inverter 3D model — OWNED by Dev A
// Sungrow SH10.0RT-style box. Pop-in animation triggered by Orchestrator step "inverter".
'use client';

import { useStore } from '@/lib/store';

export function Inverter() {
  const phase = useStore((s) => s.phase);
  const design = useStore((s) => s.design);

  if (!design || phase === 'idle' || phase === 'house-selected' || phase === 'autofilling' || phase === 'ready-to-design') return null;

  // TODO Dev A:
  // - PBR box with Sungrow texture/label
  // - Position against garage wall
  // - Pop-in animation (scale 0 → 1 with bounce easing) when step "inverter" runs
  return (
    <mesh position={[3, 1, 4]} castShadow>
      <boxGeometry args={[0.8, 1.2, 0.3]} />
      <meshStandardMaterial color="#1a1a1a" metalness={0.4} roughness={0.4} />
    </mesh>
  );
}
