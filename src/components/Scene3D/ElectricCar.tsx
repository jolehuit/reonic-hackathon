// Tesla Model 3 — OWNED by Dev A
// Parked in front of the wallbox (garage side of the house) when the
// customer profile has hasEv === true. Visible as soon as the autofill
// confirms the EV; toggling the EV off in the ControlPanel removes it.
//
// Real Model 3 length ~4.69 m. We park it parallel to the front wall,
// nose pointing right, so the charge port (driver-rear-left in real life)
// faces the house's right wall where the wallbox is mounted.

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

  // Park on a driveway to the right of the house, in front of the
  // wallbox/garage. The Tesla GLB's longest axis is its length, so we
  // ask GltfAsset to size that axis to CAR_LENGTH_M.
  const x = halfWidth + 2.6;
  const y = 0;
  const z = halfDepth + 0.5;

  return (
    <group position={[x, y, z]} rotation={[0, Math.PI, 0]}>
      <GltfAsset url="/models/tesla-model-3.glb" targetSize={CAR_LENGTH_M} />
    </group>
  );
}
