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

  // Mounted on the right exterior wall, BACK CORNER — sits next to the
  // battery (which is at z = -halfDepth + 1.5 with y = 0.4), but at a
  // higher mount point and offset further towards the rear so they don't
  // visually merge into one block from the camera's typical front-right
  // viewing angle.
  const x = halfWidth + SIZE[2] / 2 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = -halfDepth + 0.5;

  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} castShadow>
      <boxGeometry args={SIZE} />
      <meshToonMaterial color="#1c1c1c" />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
    </mesh>
  );
}
