// Wallbox EV charger — OWNED by Dev A
// Wall-mounted on the right exterior wall near the front (garage side).
// Real dimensions for typical 11 kW residential wallbox: ~0.32 × 0.42 m.
'use client';

import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { GltfAsset } from './GltfAsset';

// 0.7 m feels right on screen — a real wallbox is ~0.42 m on its longest
// face, but the generator_lp GLB has cables/handle that scale down to a
// blob if we lock to the real footprint. 0.7 keeps it readable next to
// the parked Model 3 (4.69 m) without inflating the unit absurdly.
const TARGET_LONGEST_M = 0.7;
const MOUNT_HEIGHT_FROM_GROUND = 1.0;
const GAP_FROM_WALL = 0.05;

export function Wallbox() {
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!refinements.includeWallbox) return null;

  // Mounted at the FRONT of the right wall, near the corner where the EV
  // is parked (Model 3 sits at x ≈ halfWidth + 2.6, z ≈ halfDepth + 0.5).
  // This keeps the wallbox visually adjacent to the car it charges, and
  // far enough from the battery/inverter cluster (back of the wall, z ≈
  // -halfDepth + 0.5 to + 1.5) that they don't read as one stacked block.
  const x = halfWidth + GAP_FROM_WALL + TARGET_LONGEST_M / 4;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = halfDepth - 0.4;

  return (
    <group position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
      <GltfAsset url="/models/wallbox.glb" targetSize={TARGET_LONGEST_M} />
    </group>
  );
}
