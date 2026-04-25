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

  // ---- Consensus voting on panel positions across variants ----
  //
  // Single-best-variant picking is brittle: D for Ritterstraße and F for
  // Address 4 give the right panel count but lose to the score function.
  // Consensus voting fixes this by trusting positions that MULTIPLE variants
  // independently agree on. A position kept by N≥3 variants is much more
  // likely to be a real panel slot than one only one variant ever proposes.
  const PROX_M = 0.7; // panels closer than this in XZ are "the same slot"
  // MIN_VOTES floor of 2 keeps slots even when only a couple of variants
  // independently propose them — important for Reihenhäuser where the eaves
  // are caught by only the buffer variants. The dynamic threshold below
  // ratchets it up when the resulting coverage is unphysically high.
  const MIN_VOTES = 2;

  // Each cluster: array of {panel, variantSuffix}
  type Cluster = { x: number; y: number; z: number; voters: Set<string>; panels: ModulePos[] };
  const clusters: Cluster[] = [];

  for (const s of scored) {
    const panels = s.data.modulePositions ?? [];
    for (const p of panels) {
      let assigned = false;
      for (const c of clusters) {
        if (Math.hypot(p.x - c.x, p.z - c.z) < PROX_M && Math.abs(p.y - c.y) < 1.5) {
          c.voters.add(s.variant.suffix);
          c.panels.push(p);
          // Update cluster centroid (running mean)
          const n = c.panels.length;
          c.x = (c.x * (n - 1) + p.x) / n;
          c.y = (c.y * (n - 1) + p.y) / n;
          c.z = (c.z * (n - 1) + p.z) / n;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        clusters.push({ x: p.x, y: p.y, z: p.z, voters: new Set([s.variant.suffix]), panels: [p] });
      }
    }
  }

  // Pre-compute the median roof area across variants — used as the reference
  // surface for the dynamic threshold below. Median is robust to outliers
  // (variant F sometimes catches neighbours and reports inflated roofs).
  const sortedAreas = scored.map((s) => s.faceArea).sort((a, b) => a - b);
  const medianRoof = sortedAreas[Math.floor(sortedAreas.length / 2)];

  // Dynamic threshold: start at MIN_VOTES and ratchet up until the resulting
  // panel count gives a physically reasonable coverage of the median roof
  // area. For "honest" houses the floor threshold already produces ≤ 55 %
  // coverage; for over-stacked multi-level buildings the threshold climbs
  // until the consensus thins out the redundant stacked panels.
  const COVERAGE_CAP = 0.55;
  function panelsAtThreshold(threshold: number): ModulePos[] {
    const out: ModulePos[] = [];
    for (const c of clusters) {
      if (c.voters.size < threshold) continue;
      let best = c.panels[0];
      let bestDist = Infinity;
      for (const p of c.panels) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      out.push({ ...best, x: c.x, y: c.y, z: c.z });
    }
    return out;
  }

  let threshold = MIN_VOTES;
  let winners = panelsAtThreshold(threshold);
  for (
    ;
    threshold <= scored.length && (winners.length * PANEL_AREA) / Math.max(medianRoof, 1) > COVERAGE_CAP;
    threshold++
  ) {
    winners = panelsAtThreshold(threshold + 1);
    if (winners.length === 0) break;
  }

  console.log('\n=== Consensus voting ===');
  console.log(`  unique panel slots across variants: ${clusters.length}`);
  console.log(`  vote distribution:`);
  const histogram = new Map<number, number>();
  for (const c of clusters) histogram.set(c.voters.size, (histogram.get(c.voters.size) ?? 0) + 1);
  for (const v of [...histogram.keys()].sort((a, b) => a - b)) {
    console.log(`    ${v.toString().padStart(2)} votes: ${histogram.get(v)} slots`);
  }
  console.log(`  median roof area across variants: ${medianRoof.toFixed(0)} m²`);
  console.log(`  dynamic threshold settled at ≥${threshold} votes → ${winners.length} consensus positions (coverage ${((winners.length * PANEL_AREA) / Math.max(medianRoof, 1) * 100).toFixed(0)}% of median)`);

  // ---- Rescue path: under-detection on Reihenhäuser ----
  //
  // For row houses, OSM polygon is tight to the wall and most variants miss
  // the eaves, so consensus drops them too. If our consensus coverage versus
  // the LARGEST variant's roof estimate is implausibly low (< 25 %), prefer
  // variant -O (MS Footprints) when available — it uses a more accurate
  // building outline. Otherwise fall back to -F (max-eaves OSM expansion).
  const maxRoof = Math.max(...scored.map((s) => s.faceArea));
  const consensusCovOnMax = (winners.length * PANEL_AREA) / Math.max(maxRoof, 1);
  if (consensusCovOnMax < 0.25) {
    // First-priority: variant -O (Microsoft Footprints) — more accurate polygon
    // than OSM in tight Reihenhaus configurations.
    const oVariant = scored.find((s) => s.variant.suffix === '-O');
    if (oVariant && oVariant.panelCount > winners.length * 1.5 && oVariant.coverage <= 0.65) {
      console.log(
        `  ⚠ consensus coverage on max roof (${maxRoof.toFixed(0)} m²) is only ${(consensusCovOnMax * 100).toFixed(0)}% — falling back to variant -O (MS Footprints) with ${oVariant.panelCount} panels at ${(oVariant.coverage * 100).toFixed(0)}% own-coverage`,
      );
      winners = (oVariant.data.modulePositions ?? []).map((p) => ({ ...p }));
    } else {
      const candidate = scored
        .slice()
        .sort((a, b) => b.panelCount - a.panelCount)
        .find((s) => s.coverage <= 0.65 && s.panelCount > winners.length * 1.5);
      if (candidate) {
        console.log(
          `  ⚠ consensus coverage on max roof (${maxRoof.toFixed(0)} m²) is only ${(consensusCovOnMax * 100).toFixed(0)}% — falling back to variant ${candidate.variant.suffix} (${candidate.variant.name}) with ${candidate.panelCount} panels at ${(candidate.coverage * 100).toFixed(0)}% own-coverage`,
        );
        winners = (candidate.data.modulePositions ?? []).map((p) => ({ ...p }));
      }
    }
  }

  // ---- Rescue path: multi-pavilion / campus over-detection ----
  //
  // Variant -L (multi-level-auto) only triggers its Y-band filter when the
  // building's P10..P90 Y range is large (pavilion / multi-pan stack). When
  // it triggers, its panel count drops well below the other variants' (which
  // continue to over-place across stacked levels). If L's count is < 70 % of
  // the consensus and < 70 % of the average non-L panel count, the building
  // is multi-level → trust L over the others.
  const lVariant = scored.find((s) => s.variant.suffix === '-L');
  // Only trust -L when its auto-multi-level filter ACTUALLY fired (Y-range
  // exceeded the trigger). Without this guard, L's identical-to-A behaviour
  // on residential houses can falsely trip the rescue.
  if (lVariant && lVariant.panelCount > 0 && lVariant.data._autoMultiLevel?.fired) {
    console.log(
      `  ⚠ variant -L's auto-multi-level filter fired (P10..P90 = ${lVariant.data._autoMultiLevel.p80Range?.toFixed(1)} m > ${lVariant.data._autoMultiLevel.trigger} m) — pavilion / multi-pan building detected, trusting -L (${lVariant.panelCount}) over consensus (${winners.length})`,
    );
    winners = (lVariant.data.modulePositions ?? []).map((p) => ({ ...p }));
  }

  // Build the consensus analysis.json. Use the highest-scoring variant's
  // faces / footprint / obstructions as the geometric base — those don't
  // change much across variants — and substitute our consensus panels.
  const base = scored[0].data;
  const consensus = {
    ...base,
    modulePositions: winners,
    _consensus: {
      method: 'multi-variant voting',
      variantCount: scored.length,
      minVotes: MIN_VOTES,
      uniqueSlots: clusters.length,
      keptSlots: winners.length,
    },
  };

  const canonicalPath = path.join(BAKED_DIR, `${houseId}-analysis.json`);
  await fs.writeFile(canonicalPath, JSON.stringify(consensus, null, 2));
  console.log(`\nWrote consensus → ${canonicalPath}`);
  console.log(`Final: ${winners.length} panels (${(winners.length * PANEL_AREA).toFixed(1)} m²)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
