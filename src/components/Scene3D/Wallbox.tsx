// Wallbox EV charger — OWNED by Dev A
// Compact box mounted on the right exterior wall near the front (garage side).
// Real-world dimensions: 32 cm × 42 cm × 13 cm.
'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';

const SIZE: [number, number, number] = [0.32, 0.42, 0.13];
const MOUNT_HEIGHT_FROM_GROUND = 1.1;
const GAP_FROM_WALL = 0.005;

export function Wallbox() {
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!refinements.includeWallbox) return null;

  // Mounted on the right wall, near the front-right corner (garage side).
  const x = halfWidth + SIZE[2] / 2 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = halfDepth - SIZE[0];

  return (
    <group position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={SIZE} />
        <meshToonMaterial color="#1a1a1a" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      {/* Front-facing LED stripe — emissive, escapes tone-mapping into the bloom band */}
      <mesh position={[0, 0, SIZE[2] / 2 + 0.001]}>
        <boxGeometry args={[SIZE[0] * 0.55, 0.04, 0.005]} />
        <meshStandardMaterial
          color="#22c55e"
          emissive="#22c55e"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
