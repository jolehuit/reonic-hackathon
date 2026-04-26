// Solar panels — OWNED by Dev A
// Placement strategy (GLB-driven, baked positions are NOT used for layout):
//   1. After the GLB is fully visible (glbStable), sample its XZ bbox with a
//      grid of vertical raycasts at panel-pitch resolution. Each successful
//      hit on a roof-like face (normal.y above threshold) becomes a candidate.
//   2. Score each candidate by tilt + flatness so the algorithm prefers the
//      part of the roof a real installer would target.
//   3. Greedy placement walks candidates from best score down, accepting one
//      only if (a) all four corners land on the same roof slope (no eave or
//      ridge overhang, no straddling two pitches), (b) it doesn't overlap a
//      panel already placed, (c) it isn't on a baked obstruction (chimney,
//      dormer, vent).
//   4. Stops once we hit the count requested by the k-NN sizer (design.
//      modulePositions.length).
//
// Reveal animation: the orchestrator ticks `placedCount` up from 0 to the
// total module count over a few seconds. We slice the projected positions
// array by that count, and each panel mesh, on mount, "drops" along its
// (face) normal from ~1.5 m above the final spot down onto the roof with an
// ease-out cubic — so panels appear to land one by one in order.

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Box3,
  Group,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';

// Real-world panel SKU catalogue. Each variant is a market-available form
// factor; the placement algorithm tries the full-size variant first and
// falls back to compact / mini if the roof can't fit the target count.
//   • AIKO Comet / Trina Vertex S+ — full residential 470-475 W.
//   • Half-cell 220 W — compact module for tight roof zones.
//   • Mini 120 W — fills the leftover slivers between dormers / chimneys.
// Wattage is what's used to convert the kWp target into a panel count,
// so smaller panels naturally produce a denser layout.
interface PanelVariant {
  name: string;
  size: [number, number, number];
  wattPeak: number;
}
const PANEL_VARIANT_FULL_AIKO: PanelVariant = {
  name: 'AIKO 475 W',
  size: [1.722, 0.03, 1.134],
  wattPeak: 475,
};
const PANEL_VARIANT_FULL_TRINA: PanelVariant = {
  name: 'Trina 475 W',
  size: [1.762, 0.03, 1.134],
  wattPeak: 475,
};
const PANEL_VARIANT_COMPACT: PanelVariant = {
  name: 'Half-cell 220 W',
  size: [1.10, 0.03, 0.70],
  wattPeak: 220,
};
const PANEL_VARIANT_MINI: PanelVariant = {
  name: 'Mini 120 W',
  size: [0.78, 0.03, 0.55],
  wattPeak: 120,
};
// Distance from the raycast hit point (roof surface) to the panel mesh
// CENTRE along the surface normal. Real photovoltaic panels sit on rail
// systems that lift them 10-15 cm above the tile. Half-thickness of the
// AIKO datasheet (30 mm) is 15 mm, so with LIFT = 0.13 m the panel BASE
// floats ~11.5 cm above the roof — visibly mounted, not embedded.
const PANEL_LIFT_M = 0.13;
const PANEL_COLOR = '#1a3a6e';        // PV cell deep blue (AIKO N-type look)
const PANEL_FRAME_COLOR = '#2a2f3a';  // anodised aluminium dark grey
const DROP_HEIGHT_M = 1.5;
const DROP_DURATION_MS = 550;
/** Above-roof origin for downward raycasts (must comfortably exceed any
 *  recentred GLB height). */
const RAY_ORIGIN_Y = 60;
/** Reject hits whose normal Y is below this threshold (= not roof-like:
 *  walls, ground plane, vertical surfaces). Kept moderate (0.3) so shallow
 *  Hunyuan slopes register as roof but vertical faces don't. */
const ROOF_NORMAL_Y_MIN = 0.3;
/** Two probe hits are considered to be on the same pitch if their normals
 *  agree by at least this dot product. Below ~0.85 means the angle between
 *  them exceeds ~30° — almost certainly different surfaces (dormer side,
 *  chimney face, window frame). */
const SAME_PITCH_DOT = 0.85;
/** A probe is considered an OBSTACLE relative to the candidate centre if
 *  the GLB surface at that probe deviates more than this much (along the
 *  panel normal) — picks up chimneys, dormer cubes, antennas, skylight
 *  frames protruding above OR recessed below the roof tiles. Real Velux
 *  skylights protrude 3–10 cm and recess 2-4 cm at the glass; 0.03 catches
 *  even subtle frames while leaving headroom for mesh noise. */
const OBSTACLE_Y_DELTA_M = 0.03;
/** Negative delta — a probe sitting LOWER than the centre by this much is
 *  also treated as an obstacle (recessed skylight glass, gap between tile
 *  and frame, missing tile). Tighter than the positive threshold because
 *  natural slope curvature only goes up. */
const OBSTACLE_Y_DELTA_NEG_M = 0.03;
/** Extra margin around the panel footprint when probing for obstacles —
 *  guarantees adjacent obstacles still flag the panel even if the corner
 *  itself was clean. */
const OBSTACLE_PROBE_MARGIN_M = 0.18;
/** Extra margin around analysis.json obstructions (chimneys, dormers, vents). */
const OBSTRUCTION_MARGIN_M = 0.45;
/** Overlap factor — panels can be ALMOST flush (12 % gap of the short
 *  side) but never sit on top of each other. */
const PANEL_OVERLAP_FACTOR = 0.88;
/** Sampling grid step as a fraction of panel size — used ONLY for the
 *  initial face-discovery scan. Smaller = denser detection of the roof
 *  pitches. The actual placement grid is aligned per-face on the panel
 *  pitch. */
const GRID_STEP_RATIO = 0.55;
/** External padding applied to each detected face polygon BEFORE the grid
 *  is laid down — guarantees panels never overhang the eave or ridge.
 *  Real installations leave ~30 cm clearance for snow guards and rails. */
const FACE_EXTERNAL_PADDING_M = 0.35;
/** Visible gap between adjacent panel cells (real PV arrays have rail
 *  joiners + thermal expansion gap of ~2–4 cm). Bumping to 5 cm gives a
 *  clear silhouette for each module on screen. */
const CELL_GAP_M = 0.05;
/** A grid cell is considered "covered" by the discovery scan if it lies
 *  within this distance of at least one sample hit on its cluster. Acts
 *  as an implicit polygon test for L-shaped or irregular faces. */
const CELL_COVERAGE_RADIUS_RATIO = 0.85;
const UP = new Vector3(0, 1, 0);

interface ProjectedPanel {
  faceId: number;
  x: number;
  y: number;
  z: number;
  normal: [number, number, number];
  quaternion: Quaternion;
}

interface PanelLayout {
  panels: ProjectedPanel[];
  variant: PanelVariant;
}

export function Panels() {
  const design = useStore((s) => s.design);
  const placedCount = useStore((s) => s.placedCount);
  // Wait for `glbStable` (post-morph) — not just `glbLoaded` (mounted) —
  // before doing any raycast-based projection. This guarantees the GLB is
  // at full opacity AND its world matrix has settled (the morph animates
  // the parent group's scale 0.6 → 1.0).
  const glbStable = useStore((s) => s.glbStable);
  const glbHeight = useStore((s) => s.glbHeight);
  const { modulePositions: recenteredPositions, obstructions } =
    useHouseGeometry();
  const sceneRoot = useThree((s) => s.scene);

  const glbRoofAreaM2 = useStore((s) => s.glbRoofAreaM2);

  // Variant cascade: try the brand-recommended full-size first, then fall
  // back to smaller form factors for tighter roofs. The algorithm uses the
  // first variant that hits ≥ the target kWp.
  const variants: PanelVariant[] = useMemo(() => {
    const full =
      design?.moduleBrand === 'Trina'
        ? PANEL_VARIANT_FULL_TRINA
        : PANEL_VARIANT_FULL_AIKO;
    return [full, PANEL_VARIANT_COMPACT, PANEL_VARIANT_MINI];
  }, [design?.moduleBrand]);

  // Pre-pick the most appropriate variant given the actual roof area on the
  // GLB. We compute, for each variant, the m² of roof needed to cover the
  // k-NN target kWp; the first variant whose footprint fits within the
  // packing-efficiency-adjusted roof area is the one we'll start with.
  // Falls through to the smallest if none fit (rare on real homes).
  // Packing efficiency 0.45 accounts for: only ~50% of the roof is south-
  // facing, then 80-90% of THAT is reachable after edges & obstacles.
  const PACKING_EFFICIENCY = 0.45;
  const preferredVariant = useMemo<PanelVariant>(() => {
    if (!design || !glbRoofAreaM2) return variants[0];
    const targetKwp = design.totalKwp || 0;
    const usableM2 = glbRoofAreaM2 * PACKING_EFFICIENCY;
    for (const v of variants) {
      const targetPanels = Math.max(1, Math.ceil((targetKwp * 1000) / v.wattPeak));
      const areaNeeded = targetPanels * v.size[0] * v.size[2];
      if (areaNeeded <= usableM2) return v;
    }
    return variants[variants.length - 1];
  }, [design, glbRoofAreaM2, variants]);

  // Recompute projected positions whenever the GLB is (re)loaded or its
  // measured height changes. We re-find the GLB root each time because the
  // R3F scene tree mutates around the morph animation.
  const layout = useMemo<PanelLayout | null>(() => {
    if (!glbStable) return null;
    if (!design) return null;

    // Locate the GLB root in the R3F scene. Flagged with userData.isGlbRoof
    // by <LoadedGlb/>. Forces world matrix update so raycasts use the post-
    // morph (scale 1.0) transform.
    let glbRoot: Object3D | null = null;
    sceneRoot.traverse((o) => {
      if (!glbRoot && o.userData?.isGlbRoof) glbRoot = o;
    });
    if (!glbRoot) return null;
    const glb = glbRoot as Object3D;
    glb.updateMatrixWorld(true);

    const raycaster = new Raycaster();
    const downRay = new Vector3(0, -1, 0);

    // Cast a single downward ray onto the GLB. Returns null on miss or on
    // non-roof hit (vertical wall, ground plane).
    const projectPoint = (x: number, z: number) => {
      raycaster.set(new Vector3(x, RAY_ORIGIN_Y, z), downRay);
      const hits = raycaster.intersectObject(glb, true);
      if (hits.length === 0) return null;
      const hit = hits[0];
      if (!hit.face) return null;
      const worldNormal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      if (worldNormal.y < ROOF_NORMAL_Y_MIN) return null;
      return { point: hit.point.clone(), normal: worldNormal };
    };

    const glbBox = new Box3().setFromObject(glb);
    const targetKwp = design.totalKwp || 0;
    const obstructionRadii = obstructions.map((ob) => ({
      x: ob.position[0],
      z: ob.position[2],
      r: ob.radius + OBSTRUCTION_MARGIN_M,
    }));

    // Greedy packer for ONE variant. Returns the panels it could fit.
    const packForVariant = (variant: PanelVariant): ProjectedPanel[] => {
      const stepX = variant.size[0] * GRID_STEP_RATIO;
      const stepZ = variant.size[2] * GRID_STEP_RATIO;
      const halfW = variant.size[0] / 2;
      const halfH = variant.size[2] / 2;
      const xStart = glbBox.min.x + halfW + 0.05;
      const xEnd = glbBox.max.x - halfW - 0.05;
      const zStart = glbBox.min.z + halfH + 0.05;
      const zEnd = glbBox.max.z - halfH - 0.05;

      // ── PHASE 1: ROOF DISCOVERY (sparse world-XZ scan) ───────────────
      // We sweep the GLB footprint with downward raycasts to find roof
      // surfaces. Each hit is a "sample" that contributes to a face cluster.
      interface Sample {
        point: Vector3;
        normal: Vector3;
        score: number;
      }
      const samples: Sample[] = [];
      for (let x = xStart; x <= xEnd + 1e-6; x += stepX) {
        for (let z = zStart; z <= zEnd + 1e-6; z += stepZ) {
          const hit = projectPoint(x, z);
          if (!hit) continue;
          const tiltDeg =
            (Math.acos(Math.max(0, Math.min(1, hit.normal.y))) * 180) / Math.PI;
          const tiltScore = Math.max(0, 1 - Math.abs(tiltDeg - 32) / 50);
          samples.push({
            point: hit.point,
            normal: hit.normal,
            score: hit.normal.y * (0.5 + 0.5 * tiltScore),
          });
        }
      }

      // ── PHASE 2: CLUSTER SAMPLES BY FACE ─────────────────────────────
      // Each cluster is one distinct pitch. cosine ≥ 0.92 ⇔ angle ≤ ~23°.
      const CLUSTER_DOT = 0.92;
      interface Face {
        normalSum: Vector3;
        meanNormal: Vector3;
        samples: Sample[];
        avgScore: number;
      }
      const faces: Face[] = [];
      for (const s of samples) {
        let assigned: Face | null = null;
        for (const f of faces) {
          if (f.meanNormal.dot(s.normal) >= CLUSTER_DOT) {
            assigned = f;
            break;
          }
        }
        if (assigned) {
          assigned.samples.push(s);
          assigned.normalSum.add(s.normal);
          assigned.meanNormal.copy(assigned.normalSum).normalize();
        } else {
          faces.push({
            normalSum: s.normal.clone(),
            meanNormal: s.normal.clone(),
            samples: [s],
            avgScore: 0,
          });
        }
      }
      for (const f of faces) {
        f.avgScore =
          f.samples.reduce((sum, s) => sum + s.score, 0) / f.samples.length;
      }

      // ── PHASE 3: BUILD A REGULAR GRID PER FACE ───────────────────────
      // For each face, project samples into a face-local 2D frame, take the
      // bbox, inset by FACE_EXTERNAL_PADDING_M, then tile with cells of the
      // panel's footprint. Only cells that (a) lie close to actual sample
      // hits (validity mask), (b) raycast onto the same pitch on all 8
      // probes, and (c) avoid baked obstructions become valid placements.
      interface GridCell {
        worldPoint: Vector3;
        normal: Vector3;
        quaternion: Quaternion;
        uLocal: number;
        vLocal: number;
        faceScore: number;
      }
      const allCells: GridCell[] = [];

      const cellW = variant.size[0]; // panel width = grid cell width
      const cellH = variant.size[2]; // panel depth = grid cell depth
      const halfCellW = cellW / 2;
      const halfCellH = cellH / 2;
      const coverageRadius =
        Math.max(cellW, cellH) * CELL_COVERAGE_RADIUS_RATIO;
      const coverageRadiusSq = coverageRadius * coverageRadius;

      for (const face of faces) {
        // Face frame: uAxis = world-X projected onto the plane (typically
        // along the ridge), vAxis = up-the-slope.
        const n = face.meanNormal;
        let uAxis = new Vector3(1, 0, 0).sub(n.clone().multiplyScalar(n.x));
        if (uAxis.lengthSq() < 1e-6) uAxis = new Vector3(0, 0, 1);
        uAxis.normalize();
        const vAxis = new Vector3().crossVectors(n, uAxis).normalize();
        const faceQuat = new Quaternion().setFromUnitVectors(UP, n);

        // Project samples to (uLocal, vLocal). Use any sample's point as
        // the frame origin so projection is stable.
        const origin = face.samples[0].point.clone();
        const projected = face.samples.map((s) => ({
          u: s.point.clone().sub(origin).dot(uAxis),
          v: s.point.clone().sub(origin).dot(vAxis),
        }));

        // Bbox in (u, v).
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        for (const p of projected) {
          if (p.u < uMin) uMin = p.u;
          if (p.u > uMax) uMax = p.u;
          if (p.v < vMin) vMin = p.v;
          if (p.v > vMax) vMax = p.v;
        }
        // External padding inset.
        uMin += FACE_EXTERNAL_PADDING_M;
        uMax -= FACE_EXTERNAL_PADDING_M;
        vMin += FACE_EXTERNAL_PADDING_M;
        vMax -= FACE_EXTERNAL_PADDING_M;
        if (uMax - uMin < cellW || vMax - vMin < cellH) continue;

        // Tile the inset bbox in row-major (low v → high v, then low u →
        // high u within each row). First cell starts a half-cell from the
        // bottom-left corner. Pitch = cell + visible gap so adjacent
        // panels are clearly separated on screen, like a real array.
        const pitchU = cellW + CELL_GAP_M;
        const pitchV = cellH + CELL_GAP_M;
        for (let v = vMin + halfCellH; v <= vMax - halfCellH + 1e-6; v += pitchV) {
          for (let u = uMin + halfCellW; u <= uMax - halfCellW + 1e-6; u += pitchU) {
            // Validity mask — discard cells that are too far from any
            // observed roof sample (handles L-shaped or notched faces).
            let covered = false;
            for (const p of projected) {
              const du = p.u - u;
              const dv = p.v - v;
              if (du * du + dv * dv < coverageRadiusSq) {
                covered = true;
                break;
              }
            }
            if (!covered) continue;

            // World-space cell centre.
            const worldPoint = new Vector3()
              .copy(origin)
              .addScaledVector(uAxis, u)
              .addScaledVector(vAxis, v);

            allCells.push({
              worldPoint,
              normal: n.clone(),
              quaternion: faceQuat.clone(),
              uLocal: u,
              vLocal: v,
              faceScore: face.avgScore,
            });
          }
        }
      }

      // ── PHASE 4: ORDER CELLS — SINGLE-FACE PRIORITY ──────────────────
      // We strongly prefer placing every panel on the BEST face. Cells are
      // sorted by face score first (so all of face A's cells come before
      // any of face B's), then row-major within each face. Greedy placement
      // will drain the top face entirely before touching another — only
      // falling back if the top face couldn't yield enough panels.
      allCells.sort((a, b) => {
        if (b.faceScore !== a.faceScore) return b.faceScore - a.faceScore;
        if (a.vLocal !== b.vLocal) return a.vLocal - b.vLocal;
        return a.uLocal - b.uLocal;
      });

      const minDist =
        Math.min(variant.size[0], variant.size[2]) * PANEL_OVERLAP_FACTOR;
      const minDistSq = minDist * minDist;
      const targetCount = Math.max(
        1,
        Math.round((targetKwp * 1000) / variant.wattPeak),
      );

      // ── PHASE 5: VALIDATE EACH GRID CELL & GREEDY-PLACE ──────────────
      // Cells are already row-major within their face; they're disjoint
      // (one cell = one panel slot) so we never need an XZ-distance
      // overlap check — the grid spacing is the panel pitch.
      const placed: ProjectedPanel[] = [];
      for (const cell of allCells) {
        if (placed.length >= targetCount) break;

        const extrapolated = cell.worldPoint;

        // (0) GROUND-TRUTH the cell — extrapolated point comes from one
        // arbitrary sample of the face cluster, so on a bumpy GLB it can
        // sit a few cm above or below the true roof at this XZ. Raycast
        // at (extrapolated.x, extrapolated.z) gives us the EXACT surface
        // point and EXACT normal. Without this step, panels alternately
        // appeared embedded or hovering depending on local mesh noise.
        const centerHit = projectPoint(extrapolated.x, extrapolated.z);
        if (!centerHit) continue;
        const center = centerHit.point;
        const n = centerHit.normal;

        // (a) Reject cells whose centre lies on a baked obstruction
        // (chimney / dormer / vent) — even if the cell passed the visual
        // discovery scan, we trust analysis.json placements.
        let onObstruction = false;
        for (const ob of obstructionRadii) {
          const dx = center.x - ob.x;
          const dz = center.z - ob.z;
          if (dx * dx + dz * dz < ob.r * ob.r) {
            onObstruction = true;
            break;
          }
        }
        if (onObstruction) continue;

        // (b) DENSE-GRID validation: 7×7 interior probes covering the cell
        // footprint + 8-probe perimeter ring. THE RULE: if ANY probe inside
        // the cell footprint hits a window/skylight (Y-discontinuity, normal
        // mismatch, or miss), the WHOLE cell is blocked — even if only a
        // small part of a window crosses the cell boundary. Probes are
        // spaced 1/6 of the cell side ≈ 19 cm on a 1.13 m panel, so any
        // obstacle ≥ ~25 cm wide is guaranteed to be hit.
        let uAxis = new Vector3(1, 0, 0).sub(n.clone().multiplyScalar(n.x));
        if (uAxis.lengthSq() < 1e-6) uAxis = new Vector3(0, 0, 1);
        uAxis.normalize();
        const vAxis = new Vector3().crossVectors(n, uAxis).normalize();

        const pu = halfCellW + OBSTACLE_PROBE_MARGIN_M;
        const pv = halfCellH + OBSTACLE_PROBE_MARGIN_M;
        // 7×7 = 49 interior probes covering the panel footprint, plus
        // 8 perimeter probes just outside it (catches adjacent obstacles
        // touching the cell edge — even a sliver of a window counts).
        const INTERIOR_DIVISIONS = 6;
        const interiorProbes: [number, number][] = [];
        for (let i = 0; i <= INTERIOR_DIVISIONS; i++) {
          for (let j = 0; j <= INTERIOR_DIVISIONS; j++) {
            const u = -halfCellW + (halfCellW * 2 * i) / INTERIOR_DIVISIONS;
            const v = -halfCellH + (halfCellH * 2 * j) / INTERIOR_DIVISIONS;
            interiorProbes.push([u, v]);
          }
        }
        const perimeterProbes: [number, number][] = [
          [pu, pv], [pu, -pv], [-pu, pv], [-pu, -pv],
          [pu, 0], [-pu, 0], [0, pv], [0, -pv],
        ];

        let valid = true;
        // Interior probes — strict, any failure blocks the cell.
        for (const [du, dv] of interiorProbes) {
          const pw = new Vector3()
            .copy(center)
            .addScaledVector(uAxis, du)
            .addScaledVector(vAxis, dv);
          const cp = projectPoint(pw.x, pw.z);
          if (!cp) { valid = false; break; }
          if (cp.normal.dot(n) < SAME_PITCH_DOT) { valid = false; break; }
          const delta = cp.point.clone().sub(center).dot(n);
          if (delta > OBSTACLE_Y_DELTA_M || delta < -OBSTACLE_Y_DELTA_NEG_M) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;
        // Perimeter probes — same strict rules.
        for (const [du, dv] of perimeterProbes) {
          const pw = new Vector3()
            .copy(center)
            .addScaledVector(uAxis, du)
            .addScaledVector(vAxis, dv);
          const cp = projectPoint(pw.x, pw.z);
          if (!cp) { valid = false; break; }
          if (cp.normal.dot(n) < SAME_PITCH_DOT) { valid = false; break; }
          const delta = cp.point.clone().sub(center).dot(n);
          if (delta > OBSTACLE_Y_DELTA_M || delta < -OBSTACLE_Y_DELTA_NEG_M) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // (c) CROSS-CELL OVERLAP: ground-truth raycast can shift a cell's
        // centre several cm from its grid position. Adjacent grid cells
        // that were disjoint by pitch can become overlapping after their
        // centres snap to the actual surface. Reject any candidate whose
        // centre falls within minDist of a previously placed panel —
        // distance measured in XZ to ignore slope-induced Y differences.
        let overlap = false;
        for (const p of placed) {
          const dx = center.x - p.x;
          const dz = center.z - p.z;
          if (dx * dx + dz * dz < minDistSq) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;

        placed.push({
          faceId: 0,
          x: center.x,
          y: center.y,
          z: center.z,
          // Use the ground-truth normal from the centre raycast so the
          // panel's quaternion + lift align with the actual roof slope at
          // this exact spot — not the face's mean normal.
          normal: [n.x, n.y, n.z],
          quaternion: new Quaternion().setFromUnitVectors(UP, n),
        });
      }
      return placed;
    };

    // Try preferredVariant first (chosen above based on roof area), then
    // fall back to the rest of the cascade if it under-delivers.
    const orderedVariants = [
      preferredVariant,
      ...variants.filter((v) => v !== preferredVariant),
    ];
    let bestLayout: PanelLayout | null = null;
    let bestKwpDelivered = -1;
    for (const variant of orderedVariants) {
      const panels = packForVariant(variant);
      const deliveredKwp = (panels.length * variant.wattPeak) / 1000;
      if (deliveredKwp > bestKwpDelivered) {
        bestKwpDelivered = deliveredKwp;
        bestLayout = { panels, variant };
      }
      // Acceptable: this variant covers ≥ 90 % of target — stop cascading.
      if (deliveredKwp >= targetKwp * 0.9 || deliveredKwp >= targetKwp) {
        bestLayout = { panels, variant };
        bestKwpDelivered = deliveredKwp;
        break;
      }
    }

    return bestLayout;
  }, [
    glbStable,
    glbHeight,
    design,
    recenteredPositions,
    obstructions,
    sceneRoot,
    variants,
    preferredVariant,
  ]);

  const projectedPositions = layout?.panels ?? null;
  const panelSize = layout?.variant.size ?? PANEL_VARIANT_FULL_AIKO.size;

  // Publish the actual placement count so the orchestrator's drop-animation
  // loop can size itself correctly (the variant cascade may pick compact
  // panels and produce more than design.modulePositions.length).
  const setPanelTargetCount = useStore((s) => s.setPanelTargetCount);
  useEffect(() => {
    setPanelTargetCount(projectedPositions?.length ?? 0);
  }, [projectedPositions, setPanelTargetCount]);

  if (!projectedPositions || projectedPositions.length === 0) return null;

  // The variant cascade already trimmed to the right count (target kWp /
  // variant.wattPeak). Just slice by the animation cadence.
  const visible = projectedPositions.slice(
    0,
    Math.min(placedCount, projectedPositions.length),
  );

  return (
    <group>
      {visible.map((p, i) => {
        const lx = p.x + p.normal[0] * PANEL_LIFT_M;
        const ly = p.y + p.normal[1] * PANEL_LIFT_M;
        const lz = p.z + p.normal[2] * PANEL_LIFT_M;
        return (
          <DroppingPanel
            key={`${p.faceId}_${p.x.toFixed(3)}_${p.z.toFixed(3)}_${i}`}
            finalPos={[lx, ly, lz]}
            normal={p.normal}
            quaternion={p.quaternion}
            size={panelSize}
          />
        );
      })}
    </group>
  );
}

interface DroppingPanelProps {
  finalPos: [number, number, number];
  normal: [number, number, number];
  quaternion: Quaternion;
  size: [number, number, number];
}

// Animates from `finalPos + normal * DROP_HEIGHT_M` down to `finalPos` with
// an ease-out cubic over DROP_DURATION_MS. Once settled, useFrame becomes a
// noop early-return.
function DroppingPanel({ finalPos, normal, quaternion, size }: DroppingPanelProps) {
  const groupRef = useRef<Group>(null);
  const mountedAtRef = useRef<number>(performance.now());
  const settledRef = useRef(false);

  useFrame(() => {
    if (settledRef.current || !groupRef.current) return;
    const elapsed = performance.now() - mountedAtRef.current;
    const t = Math.min(1, elapsed / DROP_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const offset = (1 - eased) * DROP_HEIGHT_M;
    groupRef.current.position.set(
      finalPos[0] + normal[0] * offset,
      finalPos[1] + normal[1] * offset,
      finalPos[2] + normal[2] * offset,
    );
    if (t >= 1) {
      settledRef.current = true;
      groupRef.current.position.set(finalPos[0], finalPos[1], finalPos[2]);
    }
  });

  // Module silhouette: an aluminium frame (full size) + the dark blue PV
  // cells slightly inset on top. Reads as a discrete, real-looking module
  // against the roof — no more featureless dark slabs.
  const FRAME_INSET = 0.045;        // 4.5 cm aluminium border per edge
  const CELL_AREA_OFFSET_Y = 0.001; // 1 mm above frame to avoid z-fight

  return (
    <group
      ref={groupRef}
      position={[
        finalPos[0] + normal[0] * DROP_HEIGHT_M,
        finalPos[1] + normal[1] * DROP_HEIGHT_M,
        finalPos[2] + normal[2] * DROP_HEIGHT_M,
      ]}
      quaternion={quaternion}
    >
      {/* Aluminium frame — full module footprint */}
      <mesh castShadow>
        <boxGeometry args={size} />
        <meshToonMaterial color={PANEL_FRAME_COLOR} />
      </mesh>
      {/* PV cell area — slightly inset, lifted just above the frame */}
      <mesh position={[0, size[1] / 2 + CELL_AREA_OFFSET_Y, 0]}>
        <boxGeometry
          args={[
            Math.max(0.05, size[0] - FRAME_INSET * 2),
            0.002,
            Math.max(0.05, size[2] - FRAME_INSET * 2),
          ]}
        />
        <meshToonMaterial color={PANEL_COLOR} />
      </mesh>
    </group>
  );
}
