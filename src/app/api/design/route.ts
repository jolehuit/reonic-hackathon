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
  // 1. Load roof analysis from public/baked/{houseId}-analysis.json
  //    (output of Dev D's analyze-roof.ts; mock for Brandenburg already committed)
  // 2. Compute roofMaxKwp = sum(face.area × 0.18 kW/m²)
  // 3. Call predictBomViaPioneer(profile, roofMaxKwp) for classif (HP, brand, inverter)
  // 4. findSimilarProjects(profile, k=3) for kWp/kWh/price regression
  // 5. Compute deltas vs median
  // 6. Use modulePositions directly from analysis.json (already placed by Dev D)
  // 7. Compute financials (price, payback, CO2) using Tavily-fetched DE tariffs
  // 8. Return DesignResult

  return NextResponse.json({ error: 'Not implemented — Dev B' }, { status: 501 });
}
