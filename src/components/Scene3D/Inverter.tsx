// Inverter 3D model — OWNED by Dev A
// Sungrow SH10.0RT-style box. Tangent to the right exterior wall.
// Real-world dimensions: 60 cm × 85 cm × 22 cm.
'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useEffectiveDesign } from '@/lib/useEffectiveDesign';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';

const SIZE: [number, number, number] = [0.6, 0.85, 0.22];
const MOUNT_HEIGHT_FROM_GROUND = 1.4;
const GAP_FROM_WALL = 0.005;

export function Inverter() {
  const phase = useStore((s) => s.phase);
  const design = useEffectiveDesign();
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (
    !design ||
    phase === 'idle' ||
    phase === 'house-selected' ||
    phase === 'autofilling' ||
    phase === 'ready-to-design'
  )
    return null;

  // Mounted on the right exterior wall, slightly forward of the back corner.
  // Box rotated 90° around Y so the back face (now along +X) sits flush with the wall.
  const x = halfWidth + SIZE[2] / 2 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = -halfDepth + SIZE[0] * 1.2;

  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} castShadow>
      <boxGeometry args={SIZE} />
      <meshToonMaterial color="#1c1c1c" />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
    </mesh>
  );
}
