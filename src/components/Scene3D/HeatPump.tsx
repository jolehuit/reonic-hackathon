// Heat pump outdoor unit — OWNED by Dev A
// Vaillant aroTHERM-style monobloc on a small concrete pad, against the left wall.
// Real-world dimensions: 110 cm × 85 cm × 45 cm.
'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';

const SIZE: [number, number, number] = [1.1, 0.85, 0.45];
const PAD_THICKNESS = 0.08;
const PAD_MARGIN = 0.15;
const GAP_FROM_WALL = 0.4;

export function HeatPump() {
  const design = useStore((s) => s.design);
  const refinements = useStore((s) => s.refinements);
  const { halfWidth } = useHouseGeometry();

  if (!design?.heatPumpModel || !refinements.includeHeatPump) return null;

  // Outdoor unit sits to the left of the house with a small concrete pad below.
  // Rotated 90° around Y so the long side faces the wall.
  const padX = -halfWidth - GAP_FROM_WALL - SIZE[2] / 2;
  const unitY = PAD_THICKNESS + SIZE[1] / 2;

  return (
    <group>
      {/* Concrete pad */}
      <mesh position={[padX, PAD_THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry
          args={[SIZE[2] + PAD_MARGIN * 2, PAD_THICKNESS, SIZE[0] + PAD_MARGIN * 2]}
        />
        <meshToonMaterial color="#9ea3aa" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      {/* Outdoor unit */}
      <mesh position={[padX, unitY, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={SIZE} />
        <meshToonMaterial color="#5b6470" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
    </group>
  );
}
