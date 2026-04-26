// Tesla Model 3 — OWNED by Dev A
// Parked alongside the right exterior wall, parallel to it, at the same
// z as the wallbox. Real Model 3 length is ~4.69 m. Rotation aligns the
// Tesla's body length with the wall so it reads as parallel parking
// against the house, with the charge port (driver-rear-left in real life)
// facing the wallbox.

'use client';

import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { GltfAsset } from './GltfAsset';

const CAR_LENGTH_M = 4.69;
const PHASE_SHOWS_VEHICLE = ['interactive', 'reviewing', 'approved'] as const;
type ShowPhase = (typeof PHASE_SHOWS_VEHICLE)[number];

export function ElectricCar() {
  const profile = useStore((s) => s.profile);
  const phase = useStore((s) => s.phase);
  const { halfWidth, halfDepth } = useHouseGeometry();

  if (!profile?.hasEv) return null;
  if (!PHASE_SHOWS_VEHICLE.includes(phase as ShowPhase)) return null;

  // Park alongside the right exterior wall: x = clearance from wall,
  // z = same as the wallbox (halfDepth - 1.5). Rotation [0, Math.PI/2, 0]
  // aligns the GLB's nose-along-X axis to nose-along-Z so the body sits
  // parallel to the wall — like parallel parking, not nose-in.
  const x = halfWidth + 2.8;
  const y = 0;
  const z = halfDepth - 1.5;

  return (
    <group position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
      <GltfAsset url="/models/tesla-model-3.glb" targetSize={CAR_LENGTH_M} />
    </group>
  );
}
