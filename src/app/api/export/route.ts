// POST /api/export — OWNED by Dev B
// Generates PDF Quick Offer 1-page from DesignResult + canvas screenshot.

import { NextRequest, NextResponse } from 'next/server';
import type { DesignResult, CustomerProfile } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    profile: CustomerProfile;
    design: DesignResult;
    canvasDataUrl?: string; // screenshot from r3f via gl.domElement.toDataURL()
    installerName?: string;
  };

  // TODO Dev B:
  // 1. Build jsPDF doc
  // 2. Add canvas screenshot at top
  // 3. Add BOM table
  // 4. Add total + ROI + CO2
  // 5. Add "Approved by ... on ..." footer
  // 6. Return PDF as Blob

  return NextResponse.json({ error: 'Not implemented — Dev B' }, { status: 501 });
}
