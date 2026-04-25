// Battery 3D model — OWNED by Dev A
// BYD-style battery cabinet. Slide-up animation from y=-2 to y=0 on step "battery".
'use client';

import { useStore } from '@/lib/store';

export function Battery() {
  const design = useStore((s) => s.design);
  const refinements = useStore((s) => s.refinements);

  if (!design?.batteryCapacityKwh || !refinements.includeBattery) return null;

  // TODO Dev A:
  // - PBR cabinet with BYD branding
  // - Slide-up animation: position.y from -2 to 0 with easeOutCubic
  // - Scale with batteryCapacityKwh (5kWh smaller, 15kWh taller)
  return (
    <mesh position={[3.5, 0.6, 4]} castShadow>
      <boxGeometry args={[0.6, 1.2, 0.4]} />
      <meshStandardMaterial color="#2a2a2a" metalness={0.3} roughness={0.5} />
    </mesh>
  );
}
