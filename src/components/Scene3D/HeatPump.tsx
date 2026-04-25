// Heat pump outdoor unit — OWNED by Dev A
// Vaillant aroTHERM-style. Fade-in + scale 0→1 on step "hp".
'use client';

import { useStore } from '@/lib/store';

export function HeatPump() {
  const design = useStore((s) => s.design);
  const refinements = useStore((s) => s.refinements);

  if (!design?.heatPumpModel || !refinements.includeHeatPump) return null;

  // TODO Dev A:
  // - PBR outdoor unit cube
  // - Fade-in via material opacity 0 → 1
  // - Position next to the house garden side
  return (
    <mesh position={[-3, 0.6, 4]} castShadow>
      <boxGeometry args={[1.0, 0.9, 0.4]} />
      <meshStandardMaterial color="#dcdcdc" metalness={0.2} roughness={0.6} />
    </mesh>
  );
}
