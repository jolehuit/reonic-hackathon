// Wallbox EV charger — OWNED by Dev A
// Pole + LED indicator. Fade-in on toggle EV/Wallbox.
'use client';

import { useStore } from '@/lib/store';

export function Wallbox() {
  const refinements = useStore((s) => s.refinements);

  if (!refinements.includeWallbox) return null;

  // TODO Dev A: pole vertical avec LED stripe pulsante
  return (
    <group position={[5, 0, 3]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.06, 0.06, 1.4]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0, 1, 0.07]}>
        <boxGeometry args={[0.18, 0.25, 0.02]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}
