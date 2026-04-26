// Wallbox EV charger — OWNED by Dev A
// Wall-mounted on the right exterior wall near the front (garage side).
// Real dimensions for typical 11 kW residential wallbox: ~0.32 × 0.42 m.
'use client';

import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { GltfAsset } from './GltfAsset';

const TARGET_LONGEST_M = 0.42;
const MOUNT_HEIGHT_FROM_GROUND = 1.1;
const GAP_FROM_WALL = 0.005;

export function Wallbox() {
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!refinements.includeWallbox) return null;

  const x = halfWidth + 0.1 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = halfDepth - 1.0;

  return (
    <group position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
      <GltfAsset url="/models/wallbox.glb" targetSize={TARGET_LONGEST_M} />
    </group>
  );
}
