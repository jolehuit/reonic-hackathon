// Wallbox EV charger — OWNED by Dev A
// Wall-mounted on the right exterior wall, aligned with where the EV is
// parked. Real residential 11 kW wallbox is ~32 cm × 42 cm × 13 cm.
//
// The GLB version of this component used `generator_lp.glb` (a yellow
// portable generator) which (a) doesn't look like a wallbox and (b) had
// off-centre geometry that left the asset floating mid-air after the
// bbox-based scaling. Procedural box reads as a Tesla Wall Connector
// silhouette with a green LED stripe and sits flush against the wall.

'use client';

import { Edges } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { EDGE_COLOR, EDGE_THRESHOLD } from './House';

const SIZE: [number, number, number] = [0.32, 0.45, 0.13];
const MOUNT_HEIGHT_FROM_GROUND = 1.05;
const GAP_FROM_WALL = 0.005;

export function Wallbox() {
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!refinements.includeWallbox) return null;

  // Mounted at the FRONT of the right exterior wall, at the same z as
  // where the Tesla parks alongside the house — so the cable reach is
  // visually plausible. Box rotated 90° around Y so its back face sits
  // flush with the wall.
  const x = halfWidth + SIZE[2] / 2 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = halfDepth - 1.5;

  return (
    <group position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={SIZE} />
        <meshToonMaterial color="#1a1a1a" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      {/* Front-facing emissive LED stripe */}
      <mesh position={[0, 0, SIZE[2] / 2 + 0.001]}>
        <boxGeometry args={[SIZE[0] * 0.55, 0.04, 0.005]} />
        <meshStandardMaterial
          color="#22c55e"
          emissive="#22c55e"
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
