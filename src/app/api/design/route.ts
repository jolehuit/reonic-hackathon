// POST /api/design — OWNED by Dev B (BOM + sizing), partially implemented by Dev D
// for the roof-area portion (so isJumelee /2 division flows through end-to-end).
// Inputs: CustomerProfile + HouseId
// Output: DesignResult — currently returns roof-only preview; Dev B fills in BOM.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { CustomerProfile, HouseId, RoofGeometry } from '@/lib/types';

// Module power density: ~180 W per m² of roof for monocrystalline panels.
const PV_DENSITY_KW_PER_SQM = 0.18;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    profile: CustomerProfile;
    houseId: HouseId;
  };
  const { profile, houseId } = body;

  // 1. Load roof analysis (output of analyze-roof.ts).
  const analysisPath = path.join(process.cwd(), 'public/baked', `${houseId}-analysis.json`);
  let analysis: RoofGeometry;
  try {
    const raw = await fs.readFile(analysisPath, 'utf-8');
    analysis = JSON.parse(raw) as RoofGeometry;
  } catch (err) {
    return NextResponse.json(
      { error: `analysis JSON not found for ${houseId}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 404 },
    );
  }

  // 2. Compute roof surface and apply the user's house-share divisor.
  //    isJumelee (Doppelhaus / semi-detached) means the OSM building polygon
  //    covers BOTH halves of a shared roof → user only owns half of the surface.
  const houseShareDivisor = profile.isJumelee ? 2 : 1;
  const roofTotalAreaSqm = analysis.faces.reduce((sum, f) => sum + f.usableArea, 0);
  const roofAttributedAreaSqm = roofTotalAreaSqm / houseShareDivisor;
  const roofMaxKwp = roofAttributedAreaSqm * PV_DENSITY_KW_PER_SQM;

  // 3-8. TODO Dev B: predictBomViaPioneer, k-NN similars, financials, etc.
  // For now, return a roof-preview payload so the UI can already render the
  // "Surface du toit / Votre logement" transparency block.
  return NextResponse.json({
    _partial: true,
    _todo: 'Dev B: BOM + sizing + financials',
    houseId,
    isJumelee: profile.isJumelee,
    roofTotalAreaSqm: Math.round(roofTotalAreaSqm * 10) / 10,
    roofAttributedAreaSqm: Math.round(roofAttributedAreaSqm * 10) / 10,
    roofMaxKwp: Math.round(roofMaxKwp * 100) / 100,
    faceCount: analysis.faces.length,
    obstructionCount: analysis.obstructions.length,
  });
}
