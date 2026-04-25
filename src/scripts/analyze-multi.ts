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
  const plausible = scored.filter(
    (s) => s.panelCount > 0 && s.coverage >= PLAUSIBLE_COV_MIN && s.coverage <= PLAUSIBLE_COV_MAX,
  );

  let winners: ModulePos[] = [];
  let pickedReason = '';
  let pickedSuffix = '';

  // Multi-pavilion override: if -L's auto-multi-level filter actually fired,
  // it's the only variant that handles stacked roof topologies correctly.
  const lVariant = scored.find((s) => s.variant.suffix === '-L');
  if (lVariant && lVariant.panelCount > 0 && lVariant.data._autoMultiLevel?.fired) {
    winners = (lVariant.data.modulePositions ?? []).map((p) => ({ ...p }));
    pickedSuffix = '-L';
    pickedReason = `auto-multi-level fired (P10..P90 = ${lVariant.data._autoMultiLevel.p80Range?.toFixed(1)} m) — pavilion building override`;
  } else if (plausible.length > 0) {
    // Median by panel count — robust to outliers like -R no-shade.
    const sorted = plausible.slice().sort((a, b) => a.panelCount - b.panelCount);
    const median = sorted[Math.floor(sorted.length / 2)];
    let pick = median;

    // Reihenhaus override: only if the median variant looks STARVED relative to
    // the largest variant's roof estimate (sign that OSM polygon is too tight).
    // Threshold: median panel area covers less than 20 % of max-roof estimate.
    // 20 % chosen so it triggers on Reihenhäuser (Address 4 = 19 %) but not on
    // residential houses where OSM is fine (Ritterstraße = 23 %).
    const maxRoof = Math.max(...scored.map((s) => s.faceArea));
    const medianCovOnMaxRoof = (median.panelCount * PANEL_AREA) / Math.max(maxRoof, 1);
    if (medianCovOnMaxRoof < 0.20) {
      const oVariant = plausible.find((s) => s.variant.suffix === '-O');
      if (oVariant && oVariant.panelCount > median.panelCount * 1.3) {
        pick = oVariant;
        pickedReason = `median starved (${(medianCovOnMaxRoof * 100).toFixed(0)}% of max roof ${maxRoof.toFixed(0)} m²) — switching to MS Footprints (-O) ${oVariant.panelCount} panels`;
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
  const consensus = {
    ...base,
    modulePositions: winners,
    _selection: {
      method: 'per-house best variant',
      variantCount: scored.length,
      plausibleCount: plausible.length,
      pickedVariant: pickedSuffix,
      pickedReason,
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
