// Google Solar API ground-truth test — TEMPORARY (delete after validation).
// Run: pnpm test:solar [lat] [lng] [houseId]
//
// Calls https://solar.googleapis.com/v1/buildingInsights:findClosest for the
// given lat/lng, writes the response to public/baked/{houseId}-solar-api.test.json,
// and prints a side-by-side comparison with the local {houseId}-analysis.json
// produced by analyze-roof.ts.
//
// Defaults to the user-measured address (52°24'29.9"N 12°58'13.8"E ≈ Brandenburg).

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_LAT = 52.408718770055735;
const DEFAULT_LNG = 12.963106383979836;
const DEFAULT_HOUSE_ID = 'berlin-dahlem';
const BAKED_DIR = path.join(process.cwd(), 'public/baked');

interface RoofSegment {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  stats: {
    areaMeters2?: number;
    groundAreaMeters2?: number;
    sunshineQuantiles?: number[];
  };
  center?: { latitude: number; longitude: number };
}

interface BuildingInsights {
  name: string;
  center: { latitude: number; longitude: number };
  imageryQuality: string;
  imageryDate?: { year: number; month: number; day: number };
  postalCode?: string;
  administrativeArea?: string;
  solarPotential?: {
    maxArrayPanelsCount?: number;
    maxArrayAreaMeters2?: number;
    panelCapacityWatts?: number;
    panelHeightMeters?: number;
    panelWidthMeters?: number;
    wholeRoofStats?: {
      areaMeters2?: number;
      groundAreaMeters2?: number;
      sunshineQuantiles?: number[];
    };
    roofSegmentStats?: RoofSegment[];
  };
}

function azimuthLabel(az: number | undefined): string {
  if (az === undefined) return '?';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((az % 360) + 360) % 360 / 45) % 8;
  return dirs[i];
}

async function fetchSolarApi(lat: number, lng: number, key: string): Promise<BuildingInsights> {
  const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
  url.searchParams.set('location.latitude', lat.toString());
  url.searchParams.set('location.longitude', lng.toString());
  url.searchParams.set('requiredQuality', 'HIGH');
  url.searchParams.set('key', key);

  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 403) {
      throw new Error(
        `Solar API returned 403. Activate it: https://console.cloud.google.com/apis/library/solar.googleapis.com\n${body}`,
      );
    }
    if (resp.status === 404) {
      throw new Error(
        `Solar API returned 404 — no Solar coverage at ${lat}, ${lng}. Try another address.\n${body}`,
      );
    }
    throw new Error(`Solar API ${resp.status} ${resp.statusText}\n${body}`);
  }
  return (await resp.json()) as BuildingInsights;
}

interface AlgoAnalysis {
  faces: Array<{ id: number; area: number; usableArea?: number; azimuth: number; tilt: number }>;
  buildingFootprint?: { center: number[]; size: number[] };
  modulePositions?: unknown[];
}

async function readAlgoAnalysis(houseId: string): Promise<AlgoAnalysis | null> {
  try {
    const raw = await fs.readFile(path.join(BAKED_DIR, `${houseId}-analysis.json`), 'utf-8');
    return JSON.parse(raw) as AlgoAnalysis;
  } catch {
    return null;
  }
}

function printSolarSummary(insights: BuildingInsights, lat: number, lng: number) {
  const sp = insights.solarPotential;
  console.log(`\n=== Solar API @ ${lat}, ${lng} ===`);
  console.log(`Imagery quality:       ${insights.imageryQuality}`);
  if (insights.imageryDate) {
    const d = insights.imageryDate;
    console.log(`Imagery date:          ${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`);
  }
  if (insights.administrativeArea || insights.postalCode) {
    console.log(`Location:              ${insights.administrativeArea ?? ''} ${insights.postalCode ?? ''}`.trim());
  }
  if (!sp) {
    console.log('No solarPotential in the response.');
    return;
  }
  const whole = sp.wholeRoofStats;
  if (whole) {
    console.log('Whole roof:');
    console.log(`  Area 3D (incliné):   ${whole.areaMeters2?.toFixed(1) ?? '?'} m²`);
    console.log(`  Area au sol:         ${whole.groundAreaMeters2?.toFixed(1) ?? '?'} m²`);
    if (whole.areaMeters2 && whole.groundAreaMeters2) {
      const ratio = whole.areaMeters2 / whole.groundAreaMeters2;
      const tiltApprox = (Math.acos(1 / ratio) * 180) / Math.PI;
      console.log(`  Tilt moyen estimé:   ~${tiltApprox.toFixed(0)}° (ratio ${ratio.toFixed(3)})`);
    }
  }
  const segs = sp.roofSegmentStats ?? [];
  console.log(`Roof segments:         ${segs.length}`);
  segs
    .slice()
    .sort((a, b) => (b.stats.areaMeters2 ?? 0) - (a.stats.areaMeters2 ?? 0))
    .forEach((s, i) => {
      const last = i === segs.length - 1;
      const prefix = last ? '  └─' : '  ├─';
      const az = s.azimuthDegrees;
      console.log(
        `${prefix} ${azimuthLabel(az).padEnd(3)} ${az !== undefined ? Math.round(az).toString().padStart(3) + '°' : ' ?  '}  tilt ${s.pitchDegrees !== undefined ? Math.round(s.pitchDegrees).toString().padStart(2) + '°' : ' ? '} → ${s.stats.areaMeters2?.toFixed(1) ?? '?'} m² 3D / ${s.stats.groundAreaMeters2?.toFixed(1) ?? '?'} m² sol`,
      );
    });
  if (sp.maxArrayPanelsCount !== undefined) {
    console.log(`Max panels:            ${sp.maxArrayPanelsCount} (${sp.maxArrayAreaMeters2?.toFixed(1) ?? '?'} m² panneaux)`);
  }
}

function printComparison(
  insights: BuildingInsights,
  algo: AlgoAnalysis | null,
  userMeasureGroundM2: number | null,
) {
  const sp = insights.solarPotential;
  if (!sp) return;
  const whole = sp.wholeRoofStats;
  console.log('\n=== Comparaison ===');

  if (algo) {
    const algoTotal = algo.faces.reduce((s, f) => s + f.area, 0);
    const algoUsable = algo.faces.reduce((s, f) => s + (f.usableArea ?? f.area), 0);
    const algoTiltAvg =
      algo.faces.reduce((s, f) => s + f.tilt * f.area, 0) /
      Math.max(algo.faces.reduce((s, f) => s + f.area, 0), 1);
    const bbox = algo.buildingFootprint?.size;
    const bboxGroundApprox = bbox ? bbox[0] * bbox[2] : null;

    const fmt = (a?: number, b?: number) => {
      if (a === undefined || b === undefined) return '   ?';
      const delta = ((a - b) / b) * 100;
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${delta.toFixed(0)}%`;
    };

    console.log(`                       Solar API      Algo Dev D     Δ (algo vs Solar)`);
    console.log(`Faces                  ${(sp.roofSegmentStats?.length ?? 0).toString().padEnd(13)}  ${algo.faces.length.toString().padEnd(13)}  ${fmt(algo.faces.length, sp.roofSegmentStats?.length)}`);
    console.log(`Aire 3D totale         ${(whole?.areaMeters2?.toFixed(1) + ' m²').padEnd(13)}  ${(algoTotal.toFixed(1) + ' m²').padEnd(13)}  ${fmt(algoTotal, whole?.areaMeters2)}`);
    if (bboxGroundApprox !== null) {
      console.log(`Aire au sol            ${(whole?.groundAreaMeters2?.toFixed(1) + ' m²').padEnd(13)}  ${(bboxGroundApprox.toFixed(1) + ' m² (bbox)').padEnd(13)}  ${fmt(bboxGroundApprox, whole?.groundAreaMeters2)}`);
    }
    const solarTilt = whole && whole.areaMeters2 && whole.groundAreaMeters2
      ? (Math.acos(whole.groundAreaMeters2 / whole.areaMeters2) * 180) / Math.PI
      : undefined;
    console.log(`Tilt moyen             ${solarTilt !== undefined ? `~${solarTilt.toFixed(0)}°` : '   ?'}            ${algoTiltAvg.toFixed(0)}°            ${fmt(algoTiltAvg, solarTilt)}`);
    console.log(`Panneaux max           ${(sp.maxArrayPanelsCount ?? '?').toString().padEnd(13)}  ${(algo.modulePositions?.length ?? 0).toString().padEnd(13)}  ${fmt(algo.modulePositions?.length, sp.maxArrayPanelsCount)}`);
    // Panel-covered area = N panels × panel area. Compare apples-to-apples with
    // Solar API's maxArrayAreaMeters2 (which is also N × panel_area).
    const panelW = sp.panelWidthMeters ?? 1.045;
    const panelH = sp.panelHeightMeters ?? 1.879;
    const algoPanelArea = (algo.modulePositions?.length ?? 0) * panelW * panelH;
    console.log(`Aire couverte panneaux ${(sp.maxArrayAreaMeters2?.toFixed(1) + ' m²').padEnd(13)}  ${(algoPanelArea.toFixed(1) + ' m²').padEnd(13)}  ${fmt(algoPanelArea, sp.maxArrayAreaMeters2)}`);
    console.log(`Aire faces (sans obstr) ${(' '.repeat(13))}  ${(algoUsable.toFixed(1) + ' m²').padEnd(13)}  (algo only)`);
  } else {
    console.log('No local algo analysis.json found — run pnpm bake:fetch + bake:analyze first.');
  }

  if (userMeasureGroundM2 !== null) {
    console.log('');
    console.log(`Mesure utilisateur (Google Maps au sol): ${userMeasureGroundM2.toFixed(2)} m²`);
    if (whole?.groundAreaMeters2) {
      const delta = ((whole.groundAreaMeters2 - userMeasureGroundM2) / userMeasureGroundM2) * 100;
      const sign = delta >= 0 ? '+' : '';
      console.log(`   vs Solar API au sol: ${whole.groundAreaMeters2.toFixed(1)} m² (Δ ${sign}${delta.toFixed(0)}%)`);
    }
  }
}

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('Missing GOOGLE_MAPS_API_KEY. Set it in .env.local first.');
    process.exit(1);
  }

  const argLat = process.argv[2] ? parseFloat(process.argv[2]) : DEFAULT_LAT;
  const argLng = process.argv[3] ? parseFloat(process.argv[3]) : DEFAULT_LNG;
  const houseId = process.argv[4] ?? DEFAULT_HOUSE_ID;

  if (Number.isNaN(argLat) || Number.isNaN(argLng)) {
    console.error('Usage: pnpm test:solar [lat] [lng] [houseId]');
    process.exit(1);
  }

  await fs.mkdir(BAKED_DIR, { recursive: true });

  console.log(`Fetching Solar API for ${argLat}, ${argLng}…`);
  let insights: BuildingInsights;
  try {
    insights = await fetchSolarApi(argLat, argLng, apiKey);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const outPath = path.join(BAKED_DIR, `${houseId}-solar-api.test.json`);
  await fs.writeFile(outPath, JSON.stringify(insights, null, 2));
  console.log(`Wrote ${outPath}`);

  printSolarSummary(insights, argLat, argLng);

  const algo = await readAlgoAnalysis(houseId);
  const userMeasure = process.env.USER_MEASURE_GROUND_M2 ? parseFloat(process.env.USER_MEASURE_GROUND_M2) : 145.82;
  printComparison(insights, algo, userMeasure);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
