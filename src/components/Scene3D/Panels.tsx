// Solar panels — OWNED by Dev A
// Placement strategy:
//   1. Each baked panel position is recentred by HouseGeometryProvider so its
//      (X, Z) lies in the same local space as the GLB.
//   2. We then raycast straight down from above (X, Z) onto the GLB mesh
//      (Hunyuan-3D output) to find the actual roof surface point — the
//      photogrammetry-baked Y is unreliable because the AI-reconstructed roof
//      doesn't match the baked roof shape.
//   3. Hits whose normal points sideways (walls, vertical faces, ground)
//      are dropped.
//   4. A greedy pass removes overlaps so no two panels share the same patch.
//   5. Baked obstructions (chimneys, dormers, vents) are excluded with a
//      safety margin.
//
// Reveal animation: the orchestrator ticks `placedCount` up from 0 to the
// total module count over a few seconds. We slice the projected positions
// array by that count, and each panel mesh, on mount, "drops" along its
// (face) normal from ~0.9 m above the final spot down onto the roof with an
// ease-out cubic — so panels appear to land one by one in order.

'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';

// Real-world panel dimensions per brand (manufacturer datasheets).
// The GLB is rendered at metric scale because <LoadedGlb/> uniformly scales
// it so its XZ bbox matches the baked buildingFootprint width/depth (which
// are in meters). So 1 GLB unit ≈ 1 real meter and using real datasheet
// dimensions here makes panels visually consistent with the actual roof
// surface area.
const PANEL_SIZES: Record<'AIKO' | 'Trina', [number, number, number]> = {
  // AIKO Comet 1/2 N-type bifacial 470 W — 1722 × 30 × 1134 mm.
  AIKO: [1.722, 0.03, 1.134],
  // Trina Vertex S+ NEG9R — 1762 × 30 × 1134 mm.
  Trina: [1.762, 0.03, 1.134],
};
const DEFAULT_PANEL_SIZE: [number, number, number] = PANEL_SIZES.AIKO;
// Distance from the raycast hit point (roof surface) to the panel mesh
// CENTRE along the surface normal. Must be ≥ panel half-thickness + visible
// clearance so the panel reads as "on" the roof, not embedded in it. With
// the AIKO datasheet thickness of 30 mm, half-thickness is 15 mm; ~6.5 cm
// extra mounting offset is what real-world rail systems use.
const PANEL_LIFT_M = 0.08;
const PANEL_COLOR = '#1a3a6e';
const DROP_HEIGHT_M = 1.5;
const DROP_DURATION_MS = 550;
/** Above-roof origin for downward raycasts (must comfortably exceed any
 *  recentred GLB height). */
const RAY_ORIGIN_Y = 60;
/** Reject hits whose normal Y is below this threshold (= not roof-like:
 *  walls, ground plane, vertical surfaces). Kept permissive (0.2) so
 *  shallow Hunyuan slopes still register as roof. */
const ROOF_NORMAL_Y_MIN = 0.2;
/** Minimum number of corners (out of 4) that must land on roof for the
 *  panel to be accepted. Tolerant of edge gaps in the AI-reconstructed
 *  mesh — only completely overhanging panels are rejected. */
const MIN_CORNERS_ON_ROOF = 2;
/** Extra margin around analysis.json obstructions. */
const OBSTRUCTION_MARGIN_M = 0.4;
const UP = new Vector3(0, 1, 0);

interface ProjectedPanel {
  faceId: number;
  x: number;
  y: number;
  z: number;
  normal: [number, number, number];
  quaternion: Quaternion;
}

export function Panels() {
  const design = useStore((s) => s.design);
  const placedCount = useStore((s) => s.placedCount);
  const glbLoaded = useStore((s) => s.glbLoaded);
  const glbHeight = useStore((s) => s.glbHeight);
  const { modulePositions: recenteredPositions, obstructions } =
    useHouseGeometry();
  const sceneRoot = useThree((s) => s.scene);

  // Pick datasheet dimensions for the brand the k-NN sizer recommended.
  // Falls back to AIKO when /api/design hasn't responded yet.
  const panelSize: [number, number, number] = design?.moduleBrand
    ? PANEL_SIZES[design.moduleBrand] ?? DEFAULT_PANEL_SIZE
    : DEFAULT_PANEL_SIZE;
  // Two panels are considered overlapping if their XZ centres are closer
  // than the SHORTER side of the panel — that's the conservative bound that
  // guarantees no overlap regardless of how each panel is rotated on the
  // roof slope (the panel is wider than tall, so the short side is the
  // worst case for collision in the dedup XZ projection).
  const minPanelDistance = Math.min(panelSize[0], panelSize[2]) * 1.0;

  // Recompute projected positions whenever the GLB is (re)loaded or its
  // measured height changes. We re-find the GLB root each time because the
  // R3F scene tree mutates around the morph animation.
  const projectedPositions = useMemo<ProjectedPanel[] | null>(() => {
    if (!glbLoaded) return null;
    if (!design) return null;

    // Source positions are the recentred baked ones (or design's, for
    // synthesised geometries that bypass the recentring path).
    const source =
      recenteredPositions.length > 0
        ? recenteredPositions
        : design.modulePositions;
    if (source.length === 0) return null;

    // Locate the GLB root in the R3F scene. It's flagged with
    // `userData.isGlbRoof = true` by <LoadedGlb/> after the GLTFLoader runs.
    let glbRoot: Object3D | null = null;
    sceneRoot.traverse((o) => {
      if (!glbRoot && o.userData?.isGlbRoof) glbRoot = o;
    });
    if (!glbRoot) return null;
    (glbRoot as Object3D).updateMatrixWorld(true);

    const raycaster = new Raycaster();
    const downRay = new Vector3(0, -1, 0);

    const glb = glbRoot as Object3D;

    // Cast a single downward ray and return the world-space hit point and
    // normal, or null if it misses or hits a non-roof surface (wall, ground,
    // vertical face). The sun-facing bias is handled upstream by the baked
    // sizing pipeline (south-ish faces only) — re-enforcing it here was
    // discarding too many valid candidates.
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

    // Step 1 — project every candidate onto the GLB roof, validating that
    // ALL FOUR corners of the panel footprint also land on roof. This
    // prevents panels from clipping into walls or overhanging the eave —
    // the centre might be on roof, but a corner just past the ridge would
    // be hanging in the air.
    const halfW = panelSize[0] / 2;
    const halfH = panelSize[2] / 2;
    const projected: ProjectedPanel[] = [];
    for (const p of source) {
      const centre = projectPoint(p.x, p.z);
      if (!centre) continue;

      // Build a face-local frame from the centre's normal to project the
      // four corners along the same slope (not along world-X/Z, which
      // would put corners higher than the slope on a tilted face).
      const n = centre.normal;
      // Pick an in-plane reference: world X projected onto the slope.
      let uAxis = new Vector3(1, 0, 0).sub(n.clone().multiplyScalar(n.x));
      if (uAxis.lengthSq() < 1e-6) uAxis = new Vector3(0, 0, 1);
      uAxis.normalize();
      const vAxis = new Vector3().crossVectors(n, uAxis).normalize();

      const corners = [
        new Vector3()
          .copy(centre.point)
          .addScaledVector(uAxis, halfW)
          .addScaledVector(vAxis, halfH),
        new Vector3()
          .copy(centre.point)
          .addScaledVector(uAxis, halfW)
          .addScaledVector(vAxis, -halfH),
        new Vector3()
          .copy(centre.point)
          .addScaledVector(uAxis, -halfW)
          .addScaledVector(vAxis, halfH),
        new Vector3()
          .copy(centre.point)
          .addScaledVector(uAxis, -halfW)
          .addScaledVector(vAxis, -halfH),
      ];

      // Require at least MIN_CORNERS_ON_ROOF (=2) of 4 corners to land on
      // roof. This accepts panels that hang slightly over the eave (which
      // is fine in real installations: panels are mounted with rails that
      // extend a bit past the roof edge) while still rejecting panels in
      // free-fall over open air.
      let cornersOnRoof = 0;
      for (const c of corners) {
        if (projectPoint(c.x, c.z)) cornersOnRoof++;
      }
      if (cornersOnRoof < MIN_CORNERS_ON_ROOF) continue;

      const q = new Quaternion().setFromUnitVectors(UP, n);
      projected.push({
        faceId: p.faceId,
        x: centre.point.x,
        y: centre.point.y,
        z: centre.point.z,
        normal: [n.x, n.y, n.z],
        quaternion: q,
      });
    }

    // Step 2 — drop overlaps. Greedy: keep candidates in baked order, skip
    // any whose XZ centre is within minPanelDistance of one already kept.
    const dedup: ProjectedPanel[] = [];
    const minDistSq = minPanelDistance * minPanelDistance;
    for (const cur of projected) {
      let overlapsKept = false;
      for (const k of dedup) {
        const dx = cur.x - k.x;
        const dz = cur.z - k.z;
        if (dx * dx + dz * dz < minDistSq) {
          overlapsKept = true;
          break;
        }
      }
      if (!overlapsKept) dedup.push(cur);
    }

    // Step 3 — exclude anything sitting on an obstruction (chimneys,
    // dormers, vents — already in GLB-aligned space because
    // HouseGeometryProvider recentred them with the same transform).
    const cleaned = dedup.filter((p) => {
      for (const ob of obstructions) {
        const dx = p.x - ob.position[0];
        const dz = p.z - ob.position[2];
        const minDist = ob.radius + OBSTRUCTION_MARGIN_M;
        if (dx * dx + dz * dz < minDist * minDist) return false;
      }
      return true;
    });

    return cleaned;
  }, [
    glbLoaded,
    glbHeight,
    design,
    recenteredPositions,
    obstructions,
    sceneRoot,
    panelSize,
    minPanelDistance,
  ]);

  if (!projectedPositions || projectedPositions.length === 0) return null;

  // Trim to the count chosen by the k-NN sizer in /api/design, then by the
  // animation slice (placedCount drives the reveal cadence).
  const targetCount = Math.min(
    design?.modulePositions.length ?? projectedPositions.length,
    projectedPositions.length,
  );
  const visible = projectedPositions.slice(
    0,
    Math.min(placedCount, targetCount),
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
      <mesh castShadow>
        <boxGeometry args={size} />
        <meshToonMaterial color={PANEL_COLOR} />
      </mesh>
    </group>
  );
}
