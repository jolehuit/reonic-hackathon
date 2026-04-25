// Battery 3D model — OWNED by Dev A
// BYD HVS-style cabinet, tangent to the right exterior wall, next to the inverter.
// Real-world dimensions: 60 cm × 130 cm × 30 cm.
'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';

const SIZE: [number, number, number] = [0.6, 1.3, 0.3];
const GAP_FROM_WALL = 0.005;

export function Battery() {
  const design = useStore((s) => s.design);
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!design?.batteryCapacityKwh || !refinements.includeBattery) return null;

  // Stands on the ground against the right exterior wall, towards the back.
  const x = halfWidth + SIZE[2] / 2 + GAP_FROM_WALL;
  const y = SIZE[1] / 2;
  const z = halfDepth - SIZE[0] * 0.8;

  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} castShadow>
      <boxGeometry args={SIZE} />
      <meshToonMaterial color="#262626" />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
    </mesh>
  );
}
