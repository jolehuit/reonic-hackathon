// POST /api/export — OWNED by Dev B
// Generates a 1-page A4 PDF "Quick Offer" from a DesignResult + canvas screenshot.
// Returned as application/pdf binary so the browser downloads it directly.

import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import type { DesignResult, CustomerProfile } from '@/lib/types';

interface ExportBody {
  profile: CustomerProfile;
  design: DesignResult;
  canvasDataUrl?: string;     // r3f screenshot from gl.domElement.toDataURL('image/png')
  installerName?: string;
  customerName?: string;
  address?: string;
}

const REONIC_GREEN: [number, number, number] = [38, 145, 100];
const DARK_TEXT: [number, number, number] = [30, 30, 30];
const MUTED_TEXT: [number, number, number] = [110, 110, 110];

export async function POST(req: NextRequest) {
  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { profile, design, canvasDataUrl, installerName, customerName, address } = body;
  if (!profile || !design) {
    return NextResponse.json({ error: 'Missing profile or design' }, { status: 400 });
  }

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const PAGE_W = 210;
  let y = 18;

  // --- Header ---
  doc.setTextColor(...REONIC_GREEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Reonic', 20, y);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Quick Solar Offer', 47, y);

  doc.setTextColor(...MUTED_TEXT);
  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleDateString('de-DE')} · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, PAGE_W - 20, y, { align: 'right' });

  // Horizontal rule
  y += 4;
  doc.setDrawColor(220, 220, 220);
  doc.line(20, y, PAGE_W - 20, y);

  // --- Customer block ---
  y += 7;
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(customerName ?? 'Customer', 20, y);
  doc.setFont('helvetica', 'normal');
  if (address) {
    y += 5;
    doc.setTextColor(...MUTED_TEXT);
    doc.setFontSize(9);
    doc.text(address, 20, y);
  }
  y += 5;
  doc.setTextColor(...MUTED_TEXT);
  doc.setFontSize(8);
  doc.text(
    `${profile.inhabitants} inhabitants · ${profile.houseSizeSqm} m² · ${profile.annualConsumptionKwh.toLocaleString('de-DE')} kWh/yr · heating: ${profile.heatingType}${profile.hasEv ? ' · EV' : ''}`,
    20,
    y,
  );

  // --- Canvas screenshot ---
  y += 8;
  if (canvasDataUrl && canvasDataUrl.startsWith('data:image/')) {
    try {
      const fmt = canvasDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(canvasDataUrl, fmt, 20, y, PAGE_W - 40, 80);
      y += 82;
    } catch {
      // skip if image fails to embed
    }
  }

  // --- Bill of Materials block ---
  y += 4;
  doc.setTextColor(...REONIC_GREEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Bill of Materials', 20, y);
  y += 6;
  doc.setTextColor(...DARK_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const bomLines: { label: string; value: string }[] = [
    {
      label: 'Solar modules',
      value: `${design.moduleCount}× ${design.moduleBrand} ${design.moduleWattPeak}Wp = ${design.totalKwp} kWp`,
    },
    {
      label: 'Inverter',
      value: `${design.inverterModel} ${design.inverterPowerKw} kW (${design.inverterLoadPercent}% load)`,
    },
    design.batteryCapacityKwh != null
      ? { label: 'Battery storage', value: `${design.batteryCapacityKwh} kWh ${design.batteryBrand}` }
      : null,
    design.heatPumpModel
      ? { label: 'Heat pump', value: `${design.heatPumpModel} ${design.heatPumpNominalPowerKw} kW` }
      : null,
    design.wallboxChargeSpeedKw != null
      ? { label: 'Wallbox', value: `${design.wallboxChargeSpeedKw} kW EV charger` }
      : null,
  ].filter((x): x is { label: string; value: string } => x !== null);

  for (const line of bomLines) {
    doc.setTextColor(...MUTED_TEXT);
    doc.text(line.label, 25, y);
    doc.setTextColor(...DARK_TEXT);
    doc.text(line.value, 70, y);
    y += 5;
  }

  // --- Financials (right-aligned KPI strip) ---
  y += 5;
  doc.setDrawColor(230, 230, 230);
  doc.line(20, y, PAGE_W - 20, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...REONIC_GREEN);
  const totalText = `€${design.totalPriceEur.toLocaleString('de-DE')}`;
  doc.text(totalText, 20, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED_TEXT);
  doc.text('Total system price (installed)', 20, y + 4);

  // KPI columns
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...DARK_TEXT);
  const kpiY = y;
  doc.text(`${design.paybackYears} yrs`, 95, kpiY);
  doc.text(`${design.co2SavedTonsPer25y} t`, 140, kpiY);
  doc.text(`${design.totalKwp} kWp`, 175, kpiY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_TEXT);
  doc.text('Payback', 95, kpiY + 4);
  doc.text('CO₂ saved (25y)', 140, kpiY + 4);
  doc.text('Capacity', 175, kpiY + 4);

  // --- Reonic evidence (similar projects) ---
  y += 14;
  doc.setTextColor(...REONIC_GREEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Validated against ${design.similarProjects.length} similar Reonic deliveries`, 20, y);
  y += 5;
  doc.setTextColor(...MUTED_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const deltaSign = design.deltaVsMedian.kwp >= 0 ? '+' : '';
  doc.text(
    `Δ vs median: ${deltaSign}${design.deltaVsMedian.kwp} kWp · battery ${deltaSign}${design.deltaVsMedian.batteryKwh} kWh`,
    20,
    y,
  );

  // --- Footer ---
  doc.setDrawColor(220, 220, 220);
  doc.line(20, 280, PAGE_W - 20, 280);
  doc.setTextColor(...MUTED_TEXT);
  doc.setFontSize(7);
  doc.text(
    `Approved by ${installerName ?? 'Reonic Team'} on ${new Date().toLocaleDateString('de-DE')} · Sized via k-NN over 1620 real Reonic deliveries · Source: ${design.source}`,
    20,
    285,
  );
  doc.text('reonic.com', PAGE_W - 20, 285, { align: 'right' });

  // jsPDF.output('arraybuffer') returns an ArrayBuffer; Web Response accepts it as BodyInit.
  const arrayBuffer = doc.output('arraybuffer');
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reonic-offer-${Date.now()}.pdf"`,
      'Content-Length': String(arrayBuffer.byteLength),
    },
  });
}
