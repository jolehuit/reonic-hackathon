// POST /api/export — OWNED by Dev B
// Generates a 1-page A4 PDF "Quick Offer" from a DesignResult + canvas screenshot.
// Returned as application/pdf binary so the browser downloads it directly.

import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import type { DesignResult, CustomerProfile } from '@/lib/types';
import { searchSolarIncentives } from '@/lib/tavily';
import { generateSolarReport } from '@/lib/report';

// PDF generation can take ~3-5s once Tavily + Gemini are in the loop.
// Force dynamic so Next doesn't try to cache, and bump the timeout.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

/** Parse "Thielallee 36, Berlin, Germany" → { country: 'Germany', region:
 *  undefined, city: 'Berlin' }. The address is comma-separated; the LAST
 *  segment is treated as country, the second-to-last as city. We don't
 *  try to disambiguate region-vs-city — the Tavily query is fed all of
 *  it as a single string anyway. */
function parseAddress(address: string | undefined): { country: string; region?: string; city?: string } {
  if (!address) return { country: 'Germany' }; // demo default
  const parts = address.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { country: 'Germany' };
  const country = parts[parts.length - 1];
  const city = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const region = parts.length >= 3 ? parts[parts.length - 3] : undefined;
  return { country, region, city };
}

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

  // Tavily looks up local solar incentives, Gemini turns the design + the
  // incentive context into a short narrative report. Both gracefully
  // degrade to empty if their API key is missing — page 2 of the PDF is
  // then simply skipped.
  const { country, region, city } = parseAddress(address);
  const incentives = await searchSolarIncentives({ country, region, city });
  const reportText = await generateSolarReport({ address, profile, design, incentives });

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const PAGE_W = 210;
  let y = 18;

  // --- Header ---
  doc.setTextColor(...REONIC_GREEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Iconic', 20, y);
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
  doc.text(`Validated against ${design.similarProjects.length} similar Iconic deliveries`, 20, y);
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
    `Approved by ${installerName ?? 'Iconic Team'} on ${new Date().toLocaleDateString('de-DE')} · Sized via k-NN over 1620 real Iconic deliveries · Source: ${design.source}`,
    20,
    285,
  );
  doc.text('iconic.haus', PAGE_W - 20, 285, { align: 'right' });

  // --- Page 2: Personalised note (Gemini) + Local incentives (Tavily) ---
  // Only render if we actually have content from at least one source.
  const hasReport = reportText.length > 0;
  const hasIncentives = incentives.results.length > 0 || !!incentives.answer;
  if (hasReport || hasIncentives) {
    doc.addPage();
    let py = 20;
    const leftMargin = 20;
    const contentWidth = PAGE_W - 40;

    // Page 2 header
    doc.setTextColor(...REONIC_GREEN);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Personalised note', leftMargin, py);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_TEXT);
    doc.text('Generated for your address', PAGE_W - leftMargin, py, { align: 'right' });
    py += 4;
    doc.setDrawColor(220, 220, 220);
    doc.line(leftMargin, py, PAGE_W - leftMargin, py);
    py += 8;

    // Gemini narrative — three blocks separated by blank lines, each
    // tagged with one of: SUMMARY / KEY BENEFITS / LOCAL INCENTIVES.
    if (hasReport) {
      const blocks = reportText
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean);
      for (const block of blocks) {
        const [firstLine, ...rest] = block.split('\n');
        const isHeader = /^(SUMMARY|KEY BENEFITS|LOCAL INCENTIVES)\b/i.test(firstLine.trim());

        if (isHeader) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(...REONIC_GREEN);
          doc.text(firstLine.trim().toUpperCase(), leftMargin, py);
          py += 5;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(...DARK_TEXT);
          for (const line of rest) {
            const wrapped = doc.splitTextToSize(line.trim(), contentWidth) as string[];
            for (const w of wrapped) {
              if (py > 270) { doc.addPage(); py = 20; }
              doc.text(w, leftMargin, py);
              py += 4.6;
            }
          }
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(...DARK_TEXT);
          const wrapped = doc.splitTextToSize(block, contentWidth) as string[];
          for (const w of wrapped) {
            if (py > 270) { doc.addPage(); py = 20; }
            doc.text(w, leftMargin, py);
            py += 4.6;
          }
        }
        py += 3;
      }
    }

    // Tavily sources block — clickable URLs the customer can verify.
    if (hasIncentives) {
      py += 4;
      if (py > 250) { doc.addPage(); py = 20; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...REONIC_GREEN);
      doc.text('Sources', leftMargin, py);
      py += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED_TEXT);
      doc.text('Independent web search via Tavily — click to verify each programme', leftMargin, py);
      py += 5;

      for (const r of incentives.results.slice(0, 5)) {
        if (py > 275) { doc.addPage(); py = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...DARK_TEXT);
        const titleLines = doc.splitTextToSize(r.title, contentWidth) as string[];
        for (const t of titleLines) {
          doc.text(t, leftMargin, py);
          py += 4.4;
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...REONIC_GREEN);
        doc.textWithLink(r.url, leftMargin, py, { url: r.url });
        py += 5;
      }
    }

    // Page 2 footer
    doc.setDrawColor(220, 220, 220);
    doc.line(leftMargin, 280, PAGE_W - leftMargin, 280);
    doc.setTextColor(...MUTED_TEXT);
    doc.setFontSize(7);
    const footerBits: string[] = [];
    if (hasReport) footerBits.push('Narrative: Gemini 3 Flash Lite');
    if (hasIncentives) footerBits.push('Incentives: Tavily web search');
    doc.text(footerBits.join(' · '), leftMargin, 285);
    doc.text('iconic.haus', PAGE_W - leftMargin, 285, { align: 'right' });
  }

  // jsPDF.output('arraybuffer') returns an ArrayBuffer; Web Response accepts it as BodyInit.
  const arrayBuffer = doc.output('arraybuffer');
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="iconic-offer-${Date.now()}.pdf"`,
      'Content-Length': String(arrayBuffer.byteLength),
    },
  });
}
