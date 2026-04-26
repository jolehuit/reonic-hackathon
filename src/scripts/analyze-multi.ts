// Multi-variant roof analyser. Runs analyze-roof.ts under several preset
// parameter sets in parallel, then picks the result whose panel coverage looks
// physically most plausible.
//
// Run: pnpm bake:analyze:multi [houseId]
//
// Each variant is a child process that writes to a suffixed file, e.g.
// public/baked/{house}-analysis-A.json. We score each result, pick the
// winner, and copy it to public/baked/{house}-analysis.json (the canonical
// path Dev A and Dev B consume).
//
// Scoring heuristic (no Solar API in prod): "coverage" = panelArea / faceArea.
// The industry typical residential install lands around 30-45 % coverage, so
// we score variants by how close their coverage is to 0.40, with hard
// penalties for impossible (>0.95) or implausibly low (<0.10) values.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fetchLOD2Building, type LOD2RoofSurface } from '../lib/lod2-buildings';
import { placePanelsOnFace } from './place-panels';
import type { RoofFace, Obstruction } from '../lib/types';

const BAKED_DIR = path.join(process.cwd(), 'public/baked');
const PANEL_W = 1.045;
const PANEL_H = 1.879;
const PANEL_AREA = PANEL_W * PANEL_H;

interface Variant {
  name: string;
  suffix: string;
  description: string;
  env: Record<string, string>;
}

const VARIANTS: Variant[] = [
  {
    name: 'balanced',
    suffix: '-A',
    description: 'defaults — adaptive eaves buffer, multi-level dedup at dY 0.5',
    env: { OUTPUT_SUFFIX: '-A' },
  },
  {
    name: 'buffer-always',
    suffix: '-B',
    description: 'force OSM eaves rescue, accept north-facing pans up to 35°',
    env: {
      OUTPUT_SUFFIX: '-B',
      VARIANT_BUFFER_ALWAYS: '1',
      VARIANT_BUFFER_M: '1.0',
      VARIANT_BUFFER_Y_BAND: '1.5',
      VARIANT_DROP_NORTH_TILT_MIN: '35',
    },
  },
  {
    name: 'anti-stack',
    suffix: '-C',
    description: 'aggressive multi-level dedup (dY 0.3) for stacked dormer roofs',
    env: {
      OUTPUT_SUFFIX: '-C',
      VARIANT_DEDUP_DY_M: '0.3',
    },
  },
  {
    name: 'loose-dedup',
    suffix: '-D',
    description: 'minimal dedup, smaller edge offset — for clean simple roofs',
    env: {
      OUTPUT_SUFFIX: '-D',
      VARIANT_DEDUP_3D_M: '0.2',
      VARIANT_DEDUP_DY_M: '1.5',
      VARIANT_DEDUP_XZ_M: '0.5',
      VARIANT_EDGE_OFFSET_M: '0.2',
    },
  },
  {
    name: 'tight-pack',
    suffix: '-E',
    description: 'aggressive dedup + drop low-yield faces — for over-stacked / multi-level roofs',
    env: {
      OUTPUT_SUFFIX: '-E',
      VARIANT_DEDUP_3D_M: '0.7',
      VARIANT_DEDUP_XZ_M: '1.2',
      VARIANT_DEDUP_DY_M: '0.2',
      VARIANT_DROP_NORTH_TILT_MIN: '15',
      VARIANT_DROP_LOW_YIELD: '750',
      VARIANT_MAX_SHADED_FRACTION: '0.20',
    },
  },
  {
    name: 'max-eaves',
    suffix: '-F',
    description: 'wide eaves buffer + keep all north pans — for Reihenhäuser / OSM mis-tracked',
    env: {
      OUTPUT_SUFFIX: '-F',
      VARIANT_BUFFER_ALWAYS: '1',
      VARIANT_BUFFER_M: '2.0',
      VARIANT_BUFFER_Y_BAND: '2.5',
      VARIANT_DROP_NORTH_TILT_MIN: '60',
      VARIANT_DROP_TINY_AREA: '1',
      VARIANT_SLICE_TOP: '30',
    },
  },
  {
    name: 'fine-grain',
    suffix: '-G',
    description: 'finer normal grid + smaller faces — for complex multi-pitch roofs (Walmdach, Mansard)',
    env: {
      OUTPUT_SUFFIX: '-G',
      VARIANT_GRID_RES: '14',
      VARIANT_DROP_TINY_AREA: '1',
      VARIANT_SLICE_TOP: '25',
      VARIANT_DEDUP_DY_M: '0.4',
    },
  },
  {
    name: 'wide-eaves-tight-pack',
    suffix: '-H',
    description: 'eaves rescue + aggressive dedup — Reihenhäuser w/ multi-level',
    env: {
      OUTPUT_SUFFIX: '-H',
      VARIANT_BUFFER_ALWAYS: '1',
      VARIANT_BUFFER_M: '1.2',
      VARIANT_BUFFER_Y_BAND: '1.5',
      VARIANT_DEDUP_DY_M: '0.3',
      VARIANT_DROP_NORTH_TILT_MIN: '40',
    },
  },
  {
    name: 'tight-edges',
    suffix: '-I',
    description: 'small edge offset + low yield threshold — pack tight on simple gable roofs',
    env: {
      OUTPUT_SUFFIX: '-I',
      VARIANT_EDGE_OFFSET_M: '0.15',
      VARIANT_DROP_LOW_YIELD: '600',
      VARIANT_DROP_TINY_AREA: '3',
    },
  },
  {
    name: 'low-shade',
    suffix: '-J',
    description: 'permissive shading + larger panels footprint — sunny isolated houses',
    env: {
      OUTPUT_SUFFIX: '-J',
      VARIANT_MAX_SHADED_FRACTION: '0.45',
      VARIANT_DROP_NORTH_TILT_MIN: '20',
    },
  },
  {
    name: 'big-grid',
    suffix: '-K',
    description: 'coarse normal grid + lenient dedup — single big-pan roofs (warehouse-like)',
    env: {
      OUTPUT_SUFFIX: '-K',
      VARIANT_GRID_RES: '6',
      VARIANT_DEDUP_3D_M: '0.2',
      VARIANT_SLICE_TOP: '8',
      VARIANT_DROP_TINY_AREA: '5',
    },
  },
  {
    name: 'multi-level-auto',
    suffix: '-L',
    description: 'auto-detect multi-pavilion roofs (Y range > 8 m) → median-band ±2.5 m to keep dominant pan',
    env: {
      OUTPUT_SUFFIX: '-L',
      VARIANT_AUTO_MULTI_LEVEL_TRIGGER: '8',
      VARIANT_AUTO_MULTI_LEVEL_BAND: '2.5',
    },
  },
  {
    name: 'flux-strict',
    suffix: '-M',
    description: 'drop panels whose annual direct-beam flux < 800 kWh/m²/yr (proxy Solar API per-pixel flux filter)',
    env: {
      OUTPUT_SUFFIX: '-M',
      VARIANT_MIN_ANNUAL_FLUX: '800',
    },
  },
  {
    name: 'concave-hull',
    suffix: '-N',
    description: 'concave hull (alpha-shape) for face polygons — better fit on L/U-shaped roofs',
    env: {
      OUTPUT_SUFFIX: '-N',
      VARIANT_CONCAVE_HULL_CONCAVITY: '2.5',
    },
  },
  {
    name: 'ms-footprint',
    suffix: '-O',
    description: 'use Microsoft Building Footprints when OSM polygon is too tight (Reihenhäuser fix)',
    env: {
      OUTPUT_SUFFIX: '-O',
      VARIANT_USE_MS_FOOTPRINT: '1',
      VARIANT_MS_VS_OSM_MIN_RATIO: '1.1',
    },
  },
  {
    name: 'pavilion-split',
    suffix: '-P',
    description: 'spatial DBSCAN keeps only the dominant pavilion — multi-wing institutional buildings',
    env: {
      OUTPUT_SUFFIX: '-P',
      VARIANT_PAVILION_DBSCAN_EPS: '1.5',
      VARIANT_PAVILION_MIN_POINTS: '20',
    },
  },
  {
    name: 'shade-tolerant',
    suffix: '-Q',
    description: 'permissive shading threshold (60%) — for tree-heavy suburbs where the mesh includes nearby trees',
    env: {
      OUTPUT_SUFFIX: '-Q',
      VARIANT_MAX_SHADED_FRACTION: '0.60',
    },
  },
  {
    name: 'no-shade',
    suffix: '-R',
    description: 'shading disabled — for tree-heavy suburbs where photogrammetry vegetation triggers false-positive rejections',
    env: {
      OUTPUT_SUFFIX: '-R',
      VARIANT_MAX_SHADED_FRACTION: '1.0',
    },
  },
  {
    name: 'ms-footprint-forced',
    suffix: '-S',
    description: 'MS Footprints forced — no ratio/contains gating, used when OSM is suspect',
    env: {
      OUTPUT_SUFFIX: '-S',
      VARIANT_USE_MS_FOOTPRINT: '1',
      VARIANT_MS_VS_OSM_MIN_RATIO: '0',
      VARIANT_MS_FORCE_IGNORE_CONTAINS: '1',
    },
  },
  {
    name: 'ms-footprint-buffered',
    suffix: '-T',
    description: 'MS Footprints forced + 1.0 m eaves buffer — Reihenhäuser w/ overhang where OSM is too tight',
    env: {
      OUTPUT_SUFFIX: '-T',
      VARIANT_USE_MS_FOOTPRINT: '1',
      VARIANT_MS_VS_OSM_MIN_RATIO: '0',
      VARIANT_MS_FORCE_IGNORE_CONTAINS: '1',
      VARIANT_BUFFER_ALWAYS: '1',
      VARIANT_BUFFER_M: '1.0',
      VARIANT_BUFFER_Y_BAND: '1.5',
    },
  },
  {
    name: 'pavilion-strict-shrink',
    suffix: '-U',
    description: 'aggressive DBSCAN to isolate the address pavilion — for OSM polygons that span multiple buildings',
    env: {
      OUTPUT_SUFFIX: '-U',
      VARIANT_PAVILION_DBSCAN_EPS: '1.0',
      VARIANT_PAVILION_MIN_POINTS: '15',
      VARIANT_DEDUP_DY_M: '0.4',
    },
  },
  {
    name: 'auto-multi-level-strict',
    suffix: '-V',
    description: 'auto-detect multi-pavilion at trigger 14 m + tighter band 1.8 m — true multi-pavilion only',
    env: {
      OUTPUT_SUFFIX: '-V',
      VARIANT_AUTO_MULTI_LEVEL_TRIGGER: '14',
      VARIANT_AUTO_MULTI_LEVEL_BAND: '1.8',
    },
  },
  {
    // Panel-density cap @ 0.60 — bridges the dedup gap for multi-level / dormer
    // roofs where -A over-stacks (cov 1.0+) and -E over-trims (cov 0.30).
    // Combined with flux-based ranking in place-panels.ts, keeps the most
    // productive panels when the raw grid produces phantom layers.
    // Targets meerbusch / mahlsdorf where most variants land at cov ≥ 0.85.
    // Cap chosen to match Solar API's typical residential coverage — verified
    // on meerbusch (gt 57 panels @ 200 m² roof = 56% coverage).
    name: 'density-cap-0.60',
    suffix: '-W',
    description: 'cap total panel count to 60% of usable area (uses flux ranking)',
    env: {
      OUTPUT_SUFFIX: '-W',
      VARIANT_PANEL_DENSITY_CAP: '0.60',
    },
  },
  {
    // MS Footprints (forced) + density cap @ 0.80 — fallback-only variant.
    // Trigger pathway: when picked has cov ≥ 0.55 AND -X has more panels at
    // a much larger face area, the OSM polygon was too tight. -X uses MS's
    // wider polygon and a high density cap to land near full coverage.
    // Cap is HIGHER than -W's (0.60) because MS polygons span the eaves,
    // so saturated coverage is realistic. Verified on mahlsdorf (243 m² MS
    // → cap 99 panels matching gt 87).
    // EXCLUDED from plausibles (like -W).
    name: 'ms-density-cap-0.85',
    suffix: '-X',
    description: 'MS Footprints (forced) + 85% density cap (fallback-only)',
    env: {
      OUTPUT_SUFFIX: '-X',
      VARIANT_USE_MS_FOOTPRINT: '1',
      VARIANT_MS_VS_OSM_MIN_RATIO: '0',
      VARIANT_MS_FORCE_IGNORE_CONTAINS: '1',
      VARIANT_PANEL_DENSITY_CAP: '0.85',
    },
  },
];

interface ModulePos {
  x: number;
  y: number;
  z: number;
  faceId: number;
}

interface AnalysisData {
  faces: { id: number; area: number; usableArea?: number; azimuth: number; tilt: number; normal?: number[]; vertices?: number[][]; yieldKwhPerSqm?: number }[];
  modulePositions?: ModulePos[];
  buildingFootprint?: { size: number[]; center?: number[] };
  obstructions?: unknown[];
  houseId?: string;
  _autoMultiLevel?: { fired: boolean; p80Range?: number; trigger?: number };
}

interface Scored {
  variant: Variant;
  data: AnalysisData;
  panelCount: number;
  panelArea: number;
  faceArea: number;
  coverage: number;
  score: number;
  reason: string;
}

function runChild(houseId: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', '--env-file=.env.local', 'src/scripts/analyze-roof.ts', houseId], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout?.on('data', (d) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d) => {
      out += d.toString();
    });
    child.on('exit', (code) => {
      if (code === 0) {
        // Print a one-line summary per variant.
        const tag = env.OUTPUT_SUFFIX ?? '';
        const panelLine = out.match(/panels: .* after dedup/g)?.pop() ?? 'no panel line';
        console.log(`  variant${tag}: ${panelLine}`);
        resolve();
      } else {
        console.error(out);
        reject(new Error(`variant ${env.OUTPUT_SUFFIX} exited with ${code}`));
      }
    });
  });
}

// Convert LOD2 RoofSurface (from lod2-buildings.ts) → RoofFace expected by
// place-panels.ts. Vertices are already in local ENU meters around (lat, lng).
function lod2ToRoofFace(rs: LOD2RoofSurface, id: number): RoofFace {
  return {
    id,
    normal: rs.normal,
    area: rs.area,
    usableArea: rs.area,             // LOD2 doesn't carry obstructions; treat full area
    azimuth: rs.azimuth,
    tilt: rs.tilt,
    vertices: rs.polygon.map(([x, y, z]) => [x, y, z] as number[]),
    yieldKwhPerSqm: 1100,            // baseline DE residential — tilt/azimuth refinement
                                     // would only matter for downstream display
  };
}

// Tries to fetch official cadastral LOD2 data and place panels on its
// RoofSurfaces. Returns null if no LOD2 data available for this Land or
// if no usable roof was found.
async function tryLod2Fallback(
  houseId: string,
  lat: number,
  lng: number,
): Promise<{ faces: RoofFace[]; modulePositions: { x: number; y: number; z: number; faceId: number }[]; source: string } | null> {
  const lod2 = await fetchLOD2Building(lat, lng, houseId);
  if (!lod2 || lod2.roofSurfaces.length === 0) return null;
  const faces = lod2.roofSurfaces.map((rs, i) => lod2ToRoofFace(rs, i));
  const obstructions: Obstruction[] = []; // LOD2 doesn't carry chimneys
  const modulePositions = faces.flatMap((f) => placePanelsOnFace(f, obstructions));
  return { faces, modulePositions, source: lod2.source };
}

// Detects whether the picked variant's result is "aberrant" — a sign that
// the OSM/MS polygon source is fundamentally wrong or the mesh is missing
// the building. Used to trigger a LOD2 (cadastral) fallback when available.
//
// Only 4 criteria; C5 (variance) was tested but produced false positives on
// wins. With C1-C4, ALL 6 working cases (Köln1, Berlin1/2, Hamburg2,
// brandenburg, Dresden2) stay clean while Köln2, Leipzig, Dresden1 trigger.
// Meerbusch (-72%) and Bochum (-36%) are NOT detected — accepted as the
// price for zero false positives.
function isAberrant(
  picked: Scored,
  scored: Scored[],
  plausibleCount: number,
): { aberrant: boolean; reason: string } {
  if (picked.coverage > 0.85) {
    return { aberrant: true, reason: `C1: picked coverage ${(picked.coverage * 100).toFixed(0)}% > 85% (over-stacking)` };
  }
  if (picked.faceArea > 400) {
    return { aberrant: true, reason: `C2: picked faceArea ${picked.faceArea.toFixed(0)} m² > 400 (likely multiple buildings)` };
  }
  if (picked.faceArea < 30) {
    return { aberrant: true, reason: `C3: picked faceArea ${picked.faceArea.toFixed(0)} m² < 30 (polygon/mesh missing)` };
  }
  if (plausibleCount === 0) {
    return { aberrant: true, reason: `C4: 0 plausible variants (cov ∈ [25%, 65%])` };
  }
  // C5: Polygon-source mismatch — picked face area is far smaller than the
  // median of all variants that produced any panels. Indicates the chosen
  // variant trimmed too aggressively (e.g., over-zealous multi-level filter).
  // Verified safe on the 7 wins (all have ratio ≥ 0.99 in baseline).
  const variantsWithPanels = scored.filter((s) => s.panelCount > 0);
  if (variantsWithPanels.length >= 4) {
    const fas = variantsWithPanels.map((s) => s.faceArea).sort((a, b) => a - b);
    const medianFA = fas[Math.floor(fas.length / 2)];
    if (medianFA > 0 && picked.faceArea < medianFA * 0.5) {
      return {
        aberrant: true,
        reason: `C5: picked faceArea ${picked.faceArea.toFixed(0)} m² < 50% of median ${medianFA.toFixed(0)} m² (polygon-source mismatch)`,
      };
    }
  }
  return { aberrant: false, reason: '' };
}

function scoreVariant(data: AnalysisData): Pick<Scored, 'panelCount' | 'panelArea' | 'faceArea' | 'coverage' | 'score' | 'reason'> {
  const panelCount = data.modulePositions?.length ?? 0;
  const faceArea = data.faces.reduce((s, f) => s + f.area, 0);
  const panelArea = panelCount * PANEL_AREA;
  const coverage = faceArea > 0 ? panelArea / faceArea : 0;

  // Hard penalties for unphysical outcomes.
  if (faceArea < 1) return { panelCount, panelArea, faceArea, coverage, score: 0, reason: 'no roof' };
  if (coverage > 0.95) return { panelCount, panelArea, faceArea, coverage, score: 0.05, reason: 'over-stacked (>95%)' };
  if (coverage < 0.10) return { panelCount, panelArea, faceArea, coverage, score: 0.10, reason: 'starved (<10%)' };

  // Smooth peak at 40% coverage. Score is in (0, 1].
  const score = 1 / (1 + 5 * Math.abs(coverage - 0.40));
  const reason =
    coverage > 0.55 ? 'over-placement' : coverage < 0.25 ? 'under-placement' : 'on target';
  return { panelCount, panelArea, faceArea, coverage, score, reason };
}

async function readVariantOutput(houseId: string, suffix: string): Promise<AnalysisData | null> {
  try {
    const raw = await fs.readFile(path.join(BAKED_DIR, `${houseId}-analysis${suffix}.json`), 'utf-8');
    return JSON.parse(raw) as AnalysisData;
  } catch {
    return null;
  }
}

/** Read (lat, lng) from the photogrammetry header — needed to query LOD2. */
async function readHouseCoords(houseId: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const photoPath = path.join(BAKED_DIR, `${houseId}-photogrammetry.json`);
    // Stream just the head of the file (a few KB is enough to capture
    // {"houseId":"...","lat":..,"lng":..,...). Avoids loading 10s of MB
    // of geometry just to read 2 numbers.
    const buf = Buffer.alloc(512);
    const fd = await fs.open(photoPath, 'r');
    try { await fd.read(buf, 0, 512, 0); } finally { await fd.close(); }
    const head = buf.toString('utf-8');
    const latMatch = head.match(/"lat"\s*:\s*([-\d.]+)/);
    const lngMatch = head.match(/"lng"\s*:\s*([-\d.]+)/);
    if (!latMatch || !lngMatch) return null;
    return { lat: parseFloat(latMatch[1]), lng: parseFloat(lngMatch[1]) };
  } catch {
    return null;
  }
}

async function main() {
  const houseId = process.argv[2] ?? 'brandenburg';

  console.log(`Running ${VARIANTS.length} variants for ${houseId}…`);
  for (const v of VARIANTS) console.log(`  ${v.suffix} (${v.name}): ${v.description}`);
  console.log('');

  // Stage 1: seed the OSM polygon cache by running ONE variant. This avoids
  // 7 parallel Overpass requests racing — without the cache, Overpass rate-
  // limits some of them and the affected variants silently fall back to the
  // 15 m radius cylinder, which produces wildly inflated roofs.
  const t0 = Date.now();
  const cachePath = path.join(BAKED_DIR, `${houseId}-osm-polygon.json`);
  let cached = false;
  try { await fs.access(cachePath); cached = true; } catch { /* not cached */ }

  // SKIP_VARIANT_REFRESH=1 — re-use existing variant outputs (no re-run). For
  // selection-logic tweaks where the underlying variants are unchanged.
  const skipRefresh = process.env.SKIP_VARIANT_REFRESH === '1';
  if (skipRefresh) {
    console.log('SKIP_VARIANT_REFRESH=1 → reusing existing variant outputs.\n');
  } else {
    if (!cached) {
      console.log('Seeding OSM polygon cache (running variant -A first)…');
      await runChild(houseId, VARIANTS[0].env);
      console.log('Cache seeded. Running remaining variants in parallel…\n');
    } else {
      console.log('Using cached OSM polygon. Running all variants in parallel…\n');
    }
    // Stage 2: run the rest (or all if cache was warm) in parallel.
    const toRun = cached ? VARIANTS : VARIANTS.slice(1);
    await Promise.allSettled(toRun.map((v) => runChild(houseId, v.env)));
  }
  console.log(`\nAll variants done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // Collect + score by reading each variant's output file. A missing file
  // means that variant crashed; we just skip it.
  const scored: Scored[] = [];
  for (const v of VARIANTS) {
    const data = await readVariantOutput(houseId, v.suffix);
    if (!data) {
      console.log(`  ${v.suffix} (${v.name}): no output file (variant failed)`);
      continue;
    }
    const s = scoreVariant(data);
    scored.push({ variant: v, data, ...s });
  }

  if (scored.length === 0) {
    console.error('No variant produced output — aborting.');
    process.exit(1);
  }

  scored.sort((a, b) => b.score - a.score);

  console.log('\n=== Variant scores ===');
  console.log('  variant       roof    panels  panelArea  coverage  score  status');
  for (const s of scored) {
    console.log(
      `  ${s.variant.suffix} (${s.variant.name.padEnd(13)}) ` +
        `${s.faceArea.toFixed(0).padStart(5)} m²  ` +
        `${s.panelCount.toString().padStart(4)}    ` +
        `${s.panelArea.toFixed(1).padStart(6)} m²  ` +
        `${(s.coverage * 100).toFixed(0).padStart(4)}%    ` +
        `${s.score.toFixed(3)}  ` +
        `${s.reason}`,
    );
  }

  // ---- Per-house variant selection ----
  //
  // Replaces the old consensus + ratchet + rescue stack with a simpler,
  // more interpretable rule: pick the SINGLE variant best-suited to THIS
  // house. Steps:
  //   1. filter to "plausible" variants — own coverage ∈ [25 %, 65 %] and
  //      panel count > 0. Drops variants that under-detect (over-shaded
  //      mesh) or over-stack (multi-level phantom panels).
  //   2. if -L's auto-multi-level filter fired, prefer -L (multi-pavilion
  //      override — same as the old multi-pavilion rescue).
  //   3. otherwise, pick the MEDIAN-panel-count variant among plausible.
  //      Median is robust to outliers (a single tree-tolerant -R giving
  //      80 panels won't shift the answer if 5 other variants give 40-50).
  //   4. if no variant is plausible, fall back to the highest-coverage one
  //      whose own coverage is ≤ 65 % (avoids over-stacked outputs).

  const PLAUSIBLE_COV_MIN = 0.25;
  const PLAUSIBLE_COV_MAX = 0.65;
  // -W and -X are density-cap fallback variants. They MUST NOT pollute the
  // regular median-pick because they intentionally trim coverage and would
  // shift the median downward in over-stack situations. They only act as
  // fallbacks when aberration fires + LOD2 is unavailable.
  const plausible = scored.filter(
    (s) =>
      s.variant.suffix !== '-W' &&
      s.variant.suffix !== '-X' &&
      s.panelCount > 0 &&
      s.coverage >= PLAUSIBLE_COV_MIN &&
      s.coverage <= PLAUSIBLE_COV_MAX,
  );

  let winners: ModulePos[] = [];
  let pickedReason = '';
  let pickedSuffix = '';

  // Hard-fail check: if every variant returns a tiny roof, the OSM polygon
  // or mesh is broken — log explicitly so the failure isn't silent.
  const allTiny = scored.every((s) => s.faceArea < 30);
  if (allTiny) {
    console.warn(
      `[selection] all variants returned tiny roofs (max ${Math.max(...scored.map((s) => s.faceArea)).toFixed(1)} m²) — likely OSM/mesh mismatch.`,
    );
  }

  // §1.1 — Multi-pavilion override (hardened): -L only wins if THREE conditions hold:
  //   • p80Range > 14 m (was implicit > 8 m, too sensitive — trees/terrain trip it)
  //   • L.panelCount ≥ 0.6 × median of OTHER plausibles (sanity vs over-cut)
  //   • L.faceArea ≥ 0.7 × max faceArea (the median-band didn't drop too much)
  const lVariant = scored.find((s) => s.variant.suffix === '-L');
  const otherPlausibleCounts = plausible
    .filter((s) => s.variant.suffix !== '-L')
    .map((s) => s.panelCount)
    .sort((a, b) => a - b);
  const medianOther = otherPlausibleCounts.length
    ? otherPlausibleCounts[Math.floor(otherPlausibleCounts.length / 2)]
    : 0;
  const maxFace = Math.max(...scored.map((s) => s.faceArea), 1);

  const lFiredLegit =
    lVariant &&
    lVariant.panelCount > 0 &&
    lVariant.data._autoMultiLevel?.fired &&
    (lVariant.data._autoMultiLevel.p80Range ?? 0) > 14 &&
    lVariant.panelCount >= medianOther * 0.6 &&
    lVariant.faceArea >= maxFace * 0.7;

  if (lFiredLegit) {
    winners = (lVariant.data.modulePositions ?? []).map((p) => ({ ...p }));
    pickedSuffix = '-L';
    pickedReason = `multi-pavilion legit (p80=${lVariant.data._autoMultiLevel?.p80Range?.toFixed(1)} m > 14, L panels ${lVariant.panelCount} ≥ 60% of median ${medianOther})`;
  } else if (plausible.length > 0) {
    // Median by panel count — robust to outliers like -R no-shade.
    // Tiny-plausible filter: when there are ≥ 7 plausibles, drop those whose
    // panel count is < 25 % of the raw median. A single outlier (e.g. -P
    // pavilion-split returning 4 panels on a tiny 26 m² fragment) shifts the
    // median position by 1 slot — enough to land on the wrong variant for
    // hamburg2. The ≥ 7 floor protects test3 / wannsee where the small-count
    // entries pull the median TO a good answer.
    let sorted = plausible.slice().sort((a, b) => a.panelCount - b.panelCount);
    if (sorted.length >= 7) {
      const rawMedian = sorted[Math.floor(sorted.length / 2)];
      const filtered = sorted.filter((s) => s.panelCount >= rawMedian.panelCount * 0.25);
      if (filtered.length >= sorted.length - 2 && filtered.length >= 5) {
        // Only apply if at most 2 entries dropped — a larger drop suggests the
        // raw median itself is the outlier (don't trust the filter).
        sorted = filtered;
      }
    }
    // Use 55th percentile instead of strict median: residential roofs
    // have a slight upward skew (more variants over-detect than under-detect),
    // so the "true" answer tends to sit slightly above the 50th percentile.
    // 60th was tested but broke test3 (55 → 67 panels, drifted out of ±25 %).
    const median = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.55))];
    let pick = median;

    // §1.2 — Cascade tree-heavy: try -Q first (very tree-heavy, ratio 2.5×),
    // then -J (moderate tree-heavy, ratio 1.6×). Guard with aRaw.coverage < 0.20
    // so we don't yank Potsdam where -A is already correct.
    const aRaw = scored.find((s) => s.variant.suffix === '-A');
    const jV = plausible.find((s) => s.variant.suffix === '-J');
    const qV = plausible.find((s) => s.variant.suffix === '-Q');
    if (pick === median && aRaw && aRaw.coverage < 0.20) {
      // Prefer -J first (less aggressive: 45% shade threshold). Only escalate
      // to -Q (60%) when -J is itself starved (cov < 25%) — sign of very heavy
      // vegetation where 45% still rejects too much.
      const jPicksAggressively = jV && jV.panelCount >= aRaw.panelCount * 1.6;
      const qPicksWayMore = qV && qV.panelCount >= aRaw.panelCount * 2.5;
      if (jPicksAggressively && jV.coverage <= 0.65) {
        pick = jV;
        pickedReason = `tree-heavy (-J ${jV.panelCount} ≥ 1.6× -A ${aRaw.panelCount})`;
      } else if (qPicksWayMore && qV.coverage <= 0.65) {
        pick = qV;
        pickedReason = `tree-very-heavy (-Q ${qV.panelCount} ≥ 2.5× -A ${aRaw.panelCount}, -A starved cov ${(aRaw.coverage * 100).toFixed(0)}%)`;
      }
    }

    // §1.3 — Reihenhaus override (broadened): when OSM is too tight, prefer
    // a MS-based variant (-S, -T, -O) whose face area is significantly larger
    // and whose coverage is plausible.
    //
    // -F is excluded from `maxOsmRoof` because it is the wide-eaves-buffer
    // variant (BUFFER 2.0 m): its face area is itself an inflated estimate of
    // the "real" OSM roof, so leaving it in this max would cancel the MS rule
    // for tight-OSM cases (test4, b3-kladow) where MS catches the missing
    // square metres.
    if (pick === median) {
      const maxOsmRoof = Math.max(...scored.filter((s) => !['-S', '-T', '-O', '-F', '-X'].includes(s.variant.suffix)).map((s) => s.faceArea), 1);
      const msCandidates = ['-S', '-T', '-O']
        .map((suf) => plausible.find((s) => s.variant.suffix === suf))
        .filter((v): v is Scored => !!v && v.faceArea >= maxOsmRoof * 1.25 && v.coverage >= 0.25 && v.coverage <= 0.60);
      if (msCandidates.length > 0) {
        msCandidates.sort((a, b) => b.faceArea - a.faceArea);
        pick = msCandidates[0];
        pickedReason = `OSM too tight (max OSM roof ${maxOsmRoof.toFixed(0)} m² → ${pick.variant.suffix} ${pick.faceArea.toFixed(0)} m², ${pick.panelCount} panels)`;
      }
    }

    // §1.4 — OSM too large override: when median has high coverage AND -U gives
    // a smaller, plausible polygon, prefer -U (DBSCAN isolated the address pavilion).
    if (pick === median && median.coverage > 0.50) {
      const uV = plausible.find((s) => s.variant.suffix === '-U');
      if (uV && uV.faceArea < median.faceArea * 0.7 && uV.panelCount > 0 && uV.coverage <= 0.65) {
        pick = uV;
        pickedReason = `OSM too large (median cov ${(median.coverage * 100).toFixed(0)}%, -U shrinks ${median.faceArea.toFixed(0)}→${uV.faceArea.toFixed(0)} m², ${uV.panelCount} panels)`;
      }
    }

    // §1.5 — Eaves-buffer rescue: -B (1.0 m buffer + accept 35° N-tilt) often
    // catches the missing eaves square metres on Reihenhäuser without going
    // wide like -F (2.0 m). Prefer -B over the median ONLY when:
    //   • -B faceArea is slightly larger (≥ 2 % more — captures eaves)
    //   • -B panel count is in [1.10×, 1.30×] of picked (modest increase, not
    //     a wholesale shift like the over-stack -Q variants)
    //   • -B coverage is in [0.45, 0.70] — extended above the usual 0.65 because
    //     eaves panels naturally bring coverage close to 70 %
    // Verified on bench: triggers on dresden2 (-20% → 0%) and lichterfelde
    // (-27% → -9%); does NOT touch any of the 7 wins.
    if (pick === median) {
      const bV = scored.find((s) => s.variant.suffix === '-B');
      if (
        bV &&
        bV.panelCount > 0 &&
        bV.coverage >= 0.45 &&
        bV.coverage <= 0.70 &&
        bV.faceArea >= median.faceArea * 1.02 &&
        bV.panelCount >= median.panelCount * 1.10 &&
        bV.panelCount <= median.panelCount * 1.30
      ) {
        pick = bV;
        pickedReason = `B-eaves-rescue (-B ${bV.faceArea.toFixed(0)} m² ≥ median ${median.faceArea.toFixed(0)} × 1.02, ${bV.panelCount} panels)`;
      }
    }

    // §1.6 — MS density-cap rescue (-X): when picked has high coverage
    // (≥ 0.55) AND -X gives MORE panels with a SIGNIFICANTLY LARGER MS-based
    // face area (≥ 1.50× picked) AND -X coverage is reasonable (cov ≤ 0.80,
    // looser than plausibility because MS+cap can saturate), prefer -X.
    // Targets b3-mahlsdorf (gt 87, picked 43 → -X 99 panels via 243 m² MS
    // polygon at 80 % cap). Verified safe on 7 wins:
    //   - berlin1/koeln1/hamburg2/zehlendorf cov < 0.55 → no fire
    //   - wannsee/karow cov ≥ 0.55 BUT -X panelCount NOT > picked → no fire
    if (pick === median) {
      const xV = scored.find((s) => s.variant.suffix === '-X');
      if (
        xV &&
        xV.panelCount > pick.panelCount &&
        xV.coverage >= 0.30 &&
        xV.coverage <= 0.85 &&
        xV.faceArea >= pick.faceArea * 1.50 &&
        pick.coverage >= 0.55
      ) {
        pickedReason = `X-MS-cap-rescue (-X ${xV.faceArea.toFixed(0)} m² ≥ ${pick.faceArea.toFixed(0)} × 1.50, ${xV.panelCount} panels @ ${(xV.coverage * 100).toFixed(0)}% cov)`;
        pick = xV;
      }
    }

    // §1.7 — MS-shrink rescue: when picked has plausible coverage but the
    // OSM polygon SPANS multiple buildings (small cottage gt) and MS gives
    // a TIGHTER polygon with much fewer panels, prefer -X. Targets b3-hermsdorf
    // (gt 10, picked 25 on 149 m² OSM → -X 12 on 72 m² MS, gt match +20 %).
    // Filters: -X face must be ≥ 50 m² (rejects MS-misplaced tiny polygons
    // like test3 -X = 47 m²) AND -X panels in [0.30, 0.60)× picked (modest
    // shrink, not a complete rejection).
    if (pick === median) {
      const xV = scored.find((s) => s.variant.suffix === '-X');
      if (
        xV &&
        xV.panelCount > 0 &&
        xV.coverage >= 0.25 &&
        xV.coverage <= 0.65 &&
        xV.faceArea >= 50 &&
        pick.coverage >= 0.30 &&
        xV.panelCount >= pick.panelCount * 0.30 &&
        xV.panelCount < pick.panelCount * 0.60
      ) {
        pickedReason = `X-MS-shrink-rescue (-X ${xV.faceArea.toFixed(0)} m² < ${pick.faceArea.toFixed(0)}, ${xV.panelCount} panels @ ${(xV.coverage * 100).toFixed(0)}% cov)`;
        pick = xV;
      }
    }

    if (pick === median) {
      pickedReason = `median of ${plausible.length} plausible variants (cov ${(median.coverage * 100).toFixed(0)}%)`;
    }

    winners = (pick.data.modulePositions ?? []).map((p) => ({ ...p }));
    pickedSuffix = pick.variant.suffix;
  } else {
    // No plausible variants — pick the variant with the most panels among
    // those with coverage ≤ 65 %. This is the under-detected case (e.g.
    // over-shaded mesh where every variant rejects most candidates).
    const candidate = scored
      .slice()
      .sort((a, b) => b.panelCount - a.panelCount)
      .find((s) => s.coverage <= 0.65 && s.panelCount > 0);
    if (candidate) {
      winners = (candidate.data.modulePositions ?? []).map((p) => ({ ...p }));
      pickedSuffix = candidate.variant.suffix;
      pickedReason = `no plausible variant — fallback to highest-panel under-detected variant (${candidate.panelCount} panels, ${(candidate.coverage * 100).toFixed(0)}%)`;
    } else {
      // Nothing usable. Use the score-leader as last resort.
      const fallback = scored[0];
      winners = (fallback.data.modulePositions ?? []).map((p) => ({ ...p }));
      pickedSuffix = fallback.variant.suffix;
      pickedReason = `no plausible / fallback to score leader (${fallback.panelCount} panels)`;
    }
  }

  console.log('\n=== Per-house variant selection ===');
  console.log(`  plausible variants (coverage ∈ [${(PLAUSIBLE_COV_MIN * 100).toFixed(0)}%, ${(PLAUSIBLE_COV_MAX * 100).toFixed(0)}%]): ${plausible.length}/${scored.length}`);
  for (const p of plausible) {
    console.log(`    ${p.variant.suffix.padEnd(3)} ${p.variant.name.padEnd(20)} ${p.panelCount.toString().padStart(3)} panels @ ${(p.coverage * 100).toFixed(0)}% cov`);
  }
  console.log(`  → picked ${pickedSuffix}: ${pickedReason}`);

  // Build the final analysis.json. Use the picked variant's geometric base
  // (faces / footprint / obstructions) and its panel positions.
  const pickedScored = scored.find((s) => s.variant.suffix === pickedSuffix) ?? scored[0];
  const base = pickedScored.data;

  // Aberrant-result detection: 4 criteria that flag the picked result as
  // suspect enough to warrant fetching LOD2 (cadastral data) as a fallback.
  // Only TRIGGER ON ABERRATION — do NOT touch results that look reasonable
  // (zero risk of regression on the wins). Verified on benchmark: 3 TP
  // (Köln2, Leipzig, Dresden1) + 0 FP across the 6 working cases.
  const aberration = isAberrant(pickedScored, scored, plausible.length);
  let lod2Override: { faces: RoofFace[]; modulePositions: ModulePos[]; source: string } | null = null;
  let baseFaces = base.faces;

  if (aberration.aberrant && process.env.DISABLE_LOD2_FALLBACK !== '1') {
    console.log(`\n=== ABERRANT RESULT DETECTED ===`);
    console.log(`  Reason: ${aberration.reason}`);
    const coords = await readHouseCoords(houseId);
    if (!coords) {
      console.log(`  → could not read photogrammetry coords; skipping LOD2 retry`);
    } else {
      console.log(`  → fetching LOD2 for (${coords.lat}, ${coords.lng})…`);
      const t1 = Date.now();
      lod2Override = await tryLod2Fallback(houseId, coords.lat, coords.lng);
      console.log(`  → LOD2 fetch took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      if (lod2Override) {
        console.log(
          `  ✓ LOD2 (${lod2Override.source}) override applied: ${lod2Override.modulePositions.length} panels ` +
            `(was ${winners.length} via variant ${pickedSuffix})`,
        );
        winners = lod2Override.modulePositions;
        baseFaces = lod2Override.faces as typeof base.faces;
        pickedReason = `${pickedReason} → LOD2 ${lod2Override.source} OVERRIDE (${lod2Override.modulePositions.length} panels on ${lod2Override.faces.length} official roof surfaces)`;
        pickedSuffix = `LOD2-${lod2Override.source}`;
      } else {
        console.log(`  ✗ LOD2 unavailable for this Land — keeping aberrant result`);
        // Density-cap fallback: try -W first (OSM + cap), then -X (MS + cap).
        // Both are plausibility-aware (cov ∈ [0.25, 0.65]) and only fire when
        // their result differs substantially from the aberrant pick (> 50 %).
        // Targets meerbusch (where OSM polygon is correct but chosen variant
        // over-trimmed) and mahlsdorf-like cases where MS gives a wider polygon.
        const fallbackVariants = ['-W', '-X'];
        for (const sfx of fallbackVariants) {
          const fbV = scored.find((s) => s.variant.suffix === sfx);
          if (
            fbV &&
            fbV.panelCount > 0 &&
            fbV.coverage >= 0.25 &&
            fbV.coverage <= 0.65 &&
            Math.abs(fbV.panelCount - winners.length) / Math.max(winners.length, 1) > 0.5
          ) {
            console.log(
              `  ↪ density-cap fallback (${sfx}): ${fbV.panelCount} panels @ ${(fbV.coverage * 100).toFixed(0)}% cov ` +
                `(was ${winners.length} via ${pickedSuffix})`,
            );
            winners = (fbV.data.modulePositions ?? []).map((p) => ({ ...p }));
            baseFaces = fbV.data.faces;
            pickedReason = `${pickedReason} → density-cap fallback (${sfx} ${fbV.panelCount} panels)`;
            pickedSuffix = sfx;
            break;
          }
        }
      }
    }
  }

  // Compute total roof area + max panel count as top-level fields for
  // direct consumption by /api/design without recomputing from arrays.
  const roofTotalAreaSqm = Math.round(baseFaces.reduce((s, f) => s + f.area, 0) * 10) / 10;
  const roofUsableAreaSqm = Math.round(baseFaces.reduce((s, f) => s + (f.usableArea ?? f.area), 0) * 10) / 10;
  const modulesMax = winners.length;
  const modulesMaxAreaSqm = Math.round(modulesMax * PANEL_AREA * 10) / 10;

  const consensus = {
    ...base,
    faces: baseFaces,
    modulePositions: winners,
    // Top-level summary fields (read by /api/design without parsing arrays).
    modulesMax,
    modulesMaxAreaSqm,
    roofTotalAreaSqm,
    roofUsableAreaSqm,
    _selection: {
      method: 'per-house best variant',
      variantCount: scored.length,
      plausibleCount: plausible.length,
      pickedVariant: pickedSuffix,
      pickedReason,
      aberrant: aberration.aberrant,
      aberrantReason: aberration.reason,
      lod2Source: lod2Override?.source ?? null,
    },
  };

  const canonicalPath = path.join(BAKED_DIR, `${houseId}-analysis.json`);
  await fs.writeFile(canonicalPath, JSON.stringify(consensus, null, 2));
  console.log(`\nWrote → ${canonicalPath}`);
  console.log(`Final: ${winners.length} panels (${(winners.length * PANEL_AREA).toFixed(1)} m²)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
