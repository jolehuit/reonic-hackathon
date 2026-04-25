// Roof yield heatmap — OWNED by Dev A
// Apply vertex colors from public/baked/{house}-yield.json onto the roof mesh.
'use client';

import { useEffect, useState } from 'react';
import type { HouseId } from '@/lib/types';

interface Props {
  houseId: HouseId;
}

interface YieldBake {
  // TODO Dev D defines exact shape in bake-yield.ts output
  vertexColors?: number[]; // RGB triplets, length = 3 * vertex_count
  perFaceYield?: { faceId: number; kwhPerSqm: number; color: [number, number, number] }[];
}

export function Heatmap({ houseId }: Props) {
  const [bake, setBake] = useState<YieldBake | null>(null);

  useEffect(() => {
    fetch(`/baked/${houseId}-yield.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBake)
      .catch(() => setBake(null));
  }, [houseId]);

  if (!bake) return null;

  // TODO Dev A:
  // - Inject vertex colors into the roof BufferGeometry attribute
  // - Use turbo gradient (red → yellow → green)
  // - Animate the painting (sweep from corner) during agent step "yield"
  return null;
}
