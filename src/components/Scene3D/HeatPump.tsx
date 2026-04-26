// Heat pump outdoor unit — OWNED by Dev A
// Panasonic WC05H3E5 monobloc on a small concrete pad against the left
// exterior wall. Real dimensions roughly 0.62 × 0.92 × 0.36 m (W×H×D).
'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';
import { GltfAsset } from './GltfAsset';

const TARGET_LONGEST_M = 0.92;
const PAD_THICKNESS = 0.08;
const PAD_FOOTPRINT = 1.4;
const GAP_FROM_WALL = 0.45;

export function HeatPump() {
  const design = useStore((s) => s.design);
  const refinements = useStore((s) => s.refinements);
  const { halfWidth } = useHouseGeometry();

  if (!design?.heatPumpModel || !refinements.includeHeatPump) return null;

  const padX = -halfWidth - GAP_FROM_WALL - PAD_FOOTPRINT / 2;

  return (
    <group>
      {/* Concrete pad */}
      <mesh position={[padX, PAD_THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[PAD_FOOTPRINT, PAD_THICKNESS, PAD_FOOTPRINT]} />
        <meshToonMaterial color="#9ea3aa" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      {/* Outdoor unit on top of the pad */}
      <group position={[padX, PAD_THICKNESS, 0]} rotation={[0, Math.PI / 2, 0]}>
        <GltfAsset url="/models/panasonic-heatpump.glb" targetSize={TARGET_LONGEST_M} />
      </group>
    </group>
  );
}
