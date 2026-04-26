// Battery 3D model — OWNED by Dev A
// Tesla Powerwall 2 (real dimensions 1.15 × 0.755 × 0.155 m), wall-mounted
// against the right exterior wall, next to the inverter.
'use client';

import { useStore } from '@/lib/store';
import { useEffectiveDesign } from '@/lib/useEffectiveDesign';
import { useHouseGeometry } from './HouseGeometry';
import { GltfAsset } from './GltfAsset';

const TARGET_HEIGHT_M = 1.15;
const POWERWALL_DEPTH_M = 0.155;
const GAP_FROM_WALL = 0.005;
const MOUNT_HEIGHT_FROM_GROUND = 0.4;

export function Battery() {
  const design = useEffectiveDesign();
  const refinements = useStore((s) => s.refinements);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!design?.batteryCapacityKwh || !refinements.includeBattery) return null;

  // Wall-mount along the right exterior wall, near the BACK of the house —
  // German installs typically put the battery in the utility room and the
  // wallbox in the garage, on opposite sides of the building. Keeping them
  // spatially separated stops them reading as one stacked block.
  const x = halfWidth + POWERWALL_DEPTH_M / 2 + GAP_FROM_WALL;
  const y = MOUNT_HEIGHT_FROM_GROUND;
  const z = -halfDepth + 1.5;

  return (
    <group position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
      <GltfAsset url="/models/tesla-powerwall.glb" targetSize={TARGET_HEIGHT_M} />
    </group>
  );
}
