// POST /api/design — OWNED by Dev B
// Inputs: CustomerProfile + HouseId
// Output: DesignResult

import { NextRequest, NextResponse } from 'next/server';
import { predictBomViaPioneer } from '@/lib/pioneer';
import type { CustomerProfile, DesignResult, HouseId } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    profile: CustomerProfile;
    houseId: HouseId;
  };

  // TODO Dev B:
  // 1. Load roof geometry from public/baked/{houseId}-roof.json
  // 2. Compute roofMaxKwp from face areas × 0.2 kW/m²
  // 3. Call predictBomViaPioneer(profile, roofMaxKwp)
  // 4. findSimilarProjects(profile, k=3)
  // 5. Compute deltas vs median
  // 6. Build modulePositions via placePanels (from public/baked or runtime)
  // 7. Compute financials (price, payback, CO2)
  // 8. Return DesignResult

  return NextResponse.json({ error: 'Not implemented — Dev B' }, { status: 501 });
}
