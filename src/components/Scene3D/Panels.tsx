// Solar panels — OWNED by Dev A
// Placement strategy: consume the modulePositions Dev D's pipeline already
// computed (faces clustered, panels packed with edge offsets and obstacle
// avoidance, scored, sliced down to /api/design's k-NN module count). At
// render time we just:
//   1. read the recentred + Y-rescaled positions from <HouseGeometryProvider/>;
//   2. for each (x, z), raycast straight down on the GLB to recover the
//      ground-truth surface normal (the recentre Y is approximate — the
//      raycast nails the panel onto the actual rendered mesh);
//   3. animate them dropping in via the existing DroppingPanel choreography.
//
// This used to be a 400-line in-browser packer (variant cascade, dense-grid
// validation, score sorting) that ignored Dev D's output and re-derived
// everything from scratch. The two engines disagreed routinely — sidebar
// said 7 modules, the 3D scene rendered 14, the PDF said 7 again. Now
// there is exactly one source of truth: the analysis.json on disk, sliced
// by k-NN, raycast-snapped per panel for visual accuracy.
//
// Reveal animation: the orchestrator ticks `placedCount` up from 0 to the
// total module count over a few seconds. We slice the projected positions
// array by that count, and each panel mesh, on mount, "drops" along its
// (face) normal from ~1.5 m above the final spot down onto the roof with an
// ease-out cubic — so panels appear to land one by one in order.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Box3,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { useStore, type EditablePanel } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';

// Real-world panel SKU — full residential 475 W. The bake step
// (analyze-multi.ts / place-panels.ts) packs at this exact size, so we
// render at the same size for visual consistency. Trina Vertex S+ exists
// as an alternate brand badge with marginally different dimensions.
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

  // Single-variant rendering — Dev D's bake step packs at full residential
  // size (1.045 × 1.879 m), so we render at the same size for visual
  // consistency with the placed positions. The variant cascade that used
  // to live here was a parallel re-derivation from raycast scans; with
  // Dev D's positions trusted as source of truth, it's no longer needed.
  const variant: PanelVariant = useMemo(() => {
    return design?.moduleBrand === 'Trina'
      ? PANEL_VARIANT_FULL_TRINA
      : PANEL_VARIANT_FULL_AIKO;
  }, [design?.moduleBrand]);

  // Recompute projected positions whenever the GLB is (re)loaded or its
  // measured height changes. We re-find the GLB root each time because the
  // R3F scene tree mutates around the morph animation.
  // Build a ProjectedPanel for each module Dev D placed, raycast-snapped
  // onto the rendered GLB so it sits flush. We trust positions, lift the
  // normal from the actual surface to absorb any morph / rescale slop.
  const layout = useMemo<PanelLayout | null>(() => {
    if (!glbStable) return null;
    if (!design) return null;
    if (!recenteredPositions || recenteredPositions.length === 0) return null;

    let glbRoot: Object3D | null = null;
    sceneRoot.traverse((o) => {
      if (!glbRoot && o.userData?.isGlbRoof) glbRoot = o;
    });
    if (!glbRoot) return null;
    const glb = glbRoot as Object3D;
    glb.updateMatrixWorld(true);

    const raycaster = new Raycaster();
    const downRay = new Vector3(0, -1, 0);

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

    // /api/design slices baked positions to design.moduleCount; for the
    // local fetch path (HouseGeometryProvider also reads the file directly)
    // we slice client-side to stay aligned with whatever the server said.
    const target = Math.min(design.moduleCount, recenteredPositions.length);
    const panels: ProjectedPanel[] = [];
    for (let i = 0; i < target; i++) {
      const pos = recenteredPositions[i];
      const projected = projectPoint(pos.x, pos.z);
      if (!projected) continue;
      panels.push({
        faceId: pos.faceId,
        x: projected.point.x,
        y: projected.point.y,
        z: projected.point.z,
        normal: [projected.normal.x, projected.normal.y, projected.normal.z],
        quaternion: new Quaternion().setFromUnitVectors(UP, projected.normal),
      });
    }
    return { panels, variant };
  }, [glbStable, glbHeight, design, recenteredPositions, sceneRoot, variant]);

  const projectedPositions = layout?.panels ?? null;
  const panelSize = layout?.variant.size ?? PANEL_VARIANT_FULL_AIKO.size;

  // Publish a "ready" signal — the orchestrator polls this to know that
  // raycast snapping has finished and it's safe to start the drop
  // animation. Value === final panel count (= design.moduleCount, modulo
  // raycast misses on a degenerate GLB).
  const setPanelTargetCount = useStore((s) => s.setPanelTargetCount);
  useEffect(() => {
    setPanelTargetCount(projectedPositions?.length ?? 0);
  }, [projectedPositions, setPanelTargetCount]);

  // Edit-mode state. Once the drop animation completes we hydrate
  // `editedPanels` from the auto layout and switch to the interactive renderer
  // (delete on click, drag to reposition, click on roof to add).
  const editedPanels = useStore((s) => s.editedPanels);
  const setEditedPanels = useStore((s) => s.setEditedPanels);
  const panelEditMode = useStore((s) => s.panelEditMode);

  const animationDone =
    !!projectedPositions &&
    projectedPositions.length > 0 &&
    placedCount >= projectedPositions.length;

  useEffect(() => {
    if (!animationDone || !projectedPositions) return;
    if (editedPanels !== null) return;
    setEditedPanels(
      projectedPositions.map((p, i) => ({
        id: `auto_${i}`,
        x: p.x,
        y: p.y,
        z: p.z,
        normal: p.normal,
      })),
    );
  }, [animationDone, projectedPositions, editedPanels, setEditedPanels]);

  if (!projectedPositions || projectedPositions.length === 0) return null;

  // Animation phase: render the existing drop choreography from the auto
  // layout, sliced by `placedCount`. No edit affordances yet.
  if (!animationDone) {
    const visible = projectedPositions.slice(0, Math.max(0, placedCount));
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

  // Static / edit phase. Source of truth is `editedPanels` once hydrated; for
  // the brief render between animation-done and the hydration useEffect, fall
  // back to a synthesised view of the auto layout (same IDs as the hydration
  // payload, so meshes don't re-mount).
  const renderList: EditablePanel[] =
    editedPanels ??
    projectedPositions.map((p, i) => ({
      id: `auto_${i}`,
      x: p.x,
      y: p.y,
      z: p.z,
      normal: p.normal,
    }));

  return (
    <group>
      {renderList.map((p) => (
        <PlacedPanel
          key={p.id}
          panel={p}
          size={panelSize}
          editMode={panelEditMode}
          others={renderList}
        />
      ))}
      {panelEditMode && <RoofPickAdder size={panelSize} others={renderList} />}
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
  // Lazily initialised on first frame — `performance.now()` is impure so we
  // can't seed it during render.
  const mountedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useFrame(() => {
    if (settledRef.current || !groupRef.current) return;
    if (mountedAtRef.current === null) mountedAtRef.current = performance.now();
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
      <mesh castShadow userData={{ isPanel: true }}>
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

// Locates the GLB root (tagged with userData.isGlbRoof by <LoadedGlb/>) and
// returns it once. Forces world-matrix update so raycasts use the post-morph
// transform.
function useGlbRoot(): Object3D | null {
  const sceneRoot = useThree((s) => s.scene);
  const glbStable = useStore((s) => s.glbStable);
  return useMemo(() => {
    if (!glbStable) return null;
    let root: Object3D | null = null;
    sceneRoot.traverse((o) => {
      if (!root && o.userData?.isGlbRoof) root = o;
    });
    if (root) (root as Object3D).updateMatrixWorld(true);
    return root;
  }, [sceneRoot, glbStable]);
}

// Reusable validator for new / dragged panels. Mirrors the constraint checks
// from `packForVariant` so manual edits respect the same rules: panel must
// land on a roof-like face, no overhang, no straddling pitches, no obstacle
// protrusion, no overlap with other panels, no baked obstruction.
function useRoofValidator(panelSize: [number, number, number]) {
  const glb = useGlbRoot();
  const { obstructions } = useHouseGeometry();
  const halfW = panelSize[0] / 2;
  const halfH = panelSize[2] / 2;
  const minDist =
    Math.min(panelSize[0], panelSize[2]) * PANEL_OVERLAP_FACTOR;
  const minDistSq = minDist * minDist;

  const obstructionRadii = useMemo(
    () =>
      obstructions.map((ob) => ({
        x: ob.position[0],
        z: ob.position[2],
        r: ob.radius + OBSTRUCTION_MARGIN_M,
      })),
    [obstructions],
  );

  const projectAt = useCallback(
    (
      x: number,
      z: number,
    ): { point: Vector3; normal: Vector3 } | null => {
      if (!glb) return null;
      const ray = new Raycaster(
        new Vector3(x, RAY_ORIGIN_Y, z),
        new Vector3(0, -1, 0),
      );
      const hits = ray.intersectObject(glb, true);
      if (hits.length === 0) return null;
      const hit = hits[0];
      if (!hit.face) return null;
      const worldNormal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      if (worldNormal.y < ROOF_NORMAL_Y_MIN) return null;
      return { point: hit.point.clone(), normal: worldNormal };
    },
    [glb],
  );

  const validateAt = useCallback(
    (
      point: Vector3,
      normal: Vector3,
      others: EditablePanel[],
      ignoreId?: string,
    ): boolean => {
      // (a) overlap with existing panels (XZ distance, fast).
      for (const p of others) {
        if (ignoreId && p.id === ignoreId) continue;
        const dx = point.x - p.x;
        const dz = point.z - p.z;
        if (dx * dx + dz * dz < minDistSq) return false;
      }
      // (b) baked obstruction (chimney / dormer / vent).
      for (const ob of obstructionRadii) {
        const dx = point.x - ob.x;
        const dz = point.z - ob.z;
        if (dx * dx + dz * dz < ob.r * ob.r) return false;
      }
      // (c) 8-probe validation: all corners + edge midpoints must hit the
      // same roof slope at roughly the same height.
      let uAxis = new Vector3(1, 0, 0).sub(
        normal.clone().multiplyScalar(normal.x),
      );
      if (uAxis.lengthSq() < 1e-6) uAxis = new Vector3(0, 0, 1);
      uAxis.normalize();
      const vAxis = new Vector3().crossVectors(normal, uAxis).normalize();
      const u = halfW + OBSTACLE_PROBE_MARGIN_M;
      const v = halfH + OBSTACLE_PROBE_MARGIN_M;
      const probes: [number, number][] = [
        [u, v],
        [u, -v],
        [-u, v],
        [-u, -v],
        [u, 0],
        [-u, 0],
        [0, v],
        [0, -v],
      ];
      for (const [pu, pv] of probes) {
        const pw = new Vector3()
          .copy(point)
          .addScaledVector(uAxis, pu)
          .addScaledVector(vAxis, pv);
        const cp = projectAt(pw.x, pw.z);
        if (!cp) return false;
        if (cp.normal.dot(normal) < SAME_PITCH_DOT) return false;
        const delta = cp.point.clone().sub(point).dot(normal);
        if (delta > OBSTACLE_Y_DELTA_M) return false;
      }
      return true;
    },
    [halfW, halfH, minDistSq, obstructionRadii, projectAt],
  );

  return { glb, projectAt, validateAt };
}

interface PlacedPanelProps {
  panel: EditablePanel;
  size: [number, number, number];
  editMode: boolean;
  others: EditablePanel[];
}

// Static (or interactive) panel. In edit mode, click-to-delete and pointer-
// down → drag-to-reposition. On invalid drag positions the mesh tints red
// so the user gets immediate feedback; release reverts to the original spot
// if invalid.
function PlacedPanel({ panel, size, editMode, others }: PlacedPanelProps) {
  const meshRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);
  const removeEditedPanel = useStore((s) => s.removeEditedPanel);
  const updateEditedPanel = useStore((s) => s.updateEditedPanel);
  const editedPanels = useStore((s) => s.editedPanels);
  const { gl, camera, raycaster, pointer } = useThree();

  const { validateAt, glb } = useRoofValidator(size);
  const dragRef = useRef<{
    pointerId: number;
    origin: { x: number; y: number; z: number; normal: [number, number, number] };
    moved: boolean;
    lastValid: boolean;
  } | null>(null);
  const [invalid, setInvalid] = useState(false);

  // Quaternion + lifted position derived from the panel's stored normal.
  const quaternion = useMemo(() => {
    const n = new Vector3(panel.normal[0], panel.normal[1], panel.normal[2]);
    return new Quaternion().setFromUnitVectors(UP, n);
  }, [panel.normal]);
  const liftedPos = useMemo<[number, number, number]>(
    () => [
      panel.x + panel.normal[0] * PANEL_LIFT_M,
      panel.y + panel.normal[1] * PANEL_LIFT_M,
      panel.z + panel.normal[2] * PANEL_LIFT_M,
    ],
    [panel.x, panel.y, panel.z, panel.normal],
  );

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!editMode) return;
    e.stopPropagation();
    if (!editedPanels) return;
    // Capture pointer on the canvas so we still get move/up after the cursor
    // leaves the small panel mesh.
    try {
      gl.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    dragRef.current = {
      pointerId: e.pointerId,
      origin: {
        x: panel.x,
        y: panel.y,
        z: panel.z,
        normal: panel.normal,
      },
      moved: false,
      lastValid: true,
    };
  };

  // Use native canvas pointer move/up so we keep receiving events after the
  // cursor leaves the panel mesh during a drag (R3F drops events when the
  // raycast no longer hits the original object).
  useEffect(() => {
    if (!editMode) return;
    const dom = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!glb) return;
      // Rebuild raycaster from the current pointer (R3F has updated it).
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(glb, true);
      if (hits.length === 0) return;
      const hit = hits[0];
      if (!hit.face) return;
      const worldNormal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      if (worldNormal.y < ROOF_NORMAL_Y_MIN) return;
      const pt = hit.point.clone();
      const ok = validateAt(pt, worldNormal, others, panel.id);
      drag.moved = true;
      drag.lastValid = ok;
      setInvalid(!ok);
      // Move the rendered group directly each frame (no re-render). We commit
      // to the store on pointer-up so a drag is a single state transition.
      const lx = pt.x + worldNormal.x * PANEL_LIFT_M;
      const ly = pt.y + worldNormal.y * PANEL_LIFT_M;
      const lz = pt.z + worldNormal.z * PANEL_LIFT_M;
      if (groupRef.current) {
        groupRef.current.position.set(lx, ly, lz);
        groupRef.current.quaternion.setFromUnitVectors(UP, worldNormal);
      }
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      try {
        if (gl.domElement.hasPointerCapture(e.pointerId)) {
          gl.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* no-op */
      }
      dragRef.current = null;
      setInvalid(false);
      if (!drag.moved) {
        // Treated as a click → delete the panel.
        removeEditedPanel(panel.id);
        return;
      }
      // Commit the new position from the rendered transform — or revert if
      // the drop point is invalid.
      if (!drag.lastValid || !groupRef.current) {
        if (groupRef.current) {
          groupRef.current.position.set(...liftedPos);
          groupRef.current.quaternion.copy(quaternion);
        }
        return;
      }
      const pos = groupRef.current.position;
      // Recover the surface point by undoing the lift along the dragged normal.
      const q = groupRef.current.quaternion;
      const nv = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
      const surfaceX = pos.x - nv.x * PANEL_LIFT_M;
      const surfaceY = pos.y - nv.y * PANEL_LIFT_M;
      const surfaceZ = pos.z - nv.z * PANEL_LIFT_M;
      updateEditedPanel(panel.id, {
        x: surfaceX,
        y: surfaceY,
        z: surfaceZ,
        normal: [nv.x, nv.y, nv.z],
      });
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
    };
  }, [
    editMode,
    gl,
    camera,
    raycaster,
    pointer,
    glb,
    validateAt,
    others,
    panel.id,
    removeEditedPanel,
    updateEditedPanel,
    liftedPos,
    quaternion,
  ]);

  // Match the upstream DroppingPanel material breakdown: aluminium frame
  // body + slightly inset PV cell sheet 1 mm above. In edit mode an invalid
  // drop tints both red so feedback is clearly visible regardless of which
  // surface the cursor is over.
  const FRAME_INSET = 0.045;
  const CELL_AREA_OFFSET_Y = 0.001;
  const cellSize: [number, number, number] = [
    Math.max(0.05, size[0] - FRAME_INSET * 2),
    0.002,
    Math.max(0.05, size[2] - FRAME_INSET * 2),
  ];

  return (
    <group ref={groupRef} position={liftedPos} quaternion={quaternion}>
      <mesh
        ref={meshRef}
        castShadow
        userData={{ isPanel: true, panelId: panel.id }}
        onPointerDown={handlePointerDown}
        onPointerOver={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          if (!editMode) return;
          document.body.style.cursor = '';
        }}
      >
        <boxGeometry args={size} />
        <meshToonMaterial color={invalid ? '#c0392b' : PANEL_FRAME_COLOR} />
      </mesh>
      <mesh
        position={[0, size[1] / 2 + CELL_AREA_OFFSET_Y, 0]}
        userData={{ isPanel: true, panelId: panel.id }}
      >
        <boxGeometry args={cellSize} />
        <meshToonMaterial color={invalid ? '#e74c3c' : PANEL_COLOR} />
      </mesh>
      {editMode && (
        <mesh position={[0, size[1] * 0.5 + 0.006, 0]}>
          <boxGeometry args={[size[0] * 1.04, 0.005, size[2] * 1.04]} />
          <meshBasicMaterial
            color={invalid ? '#e74c3c' : '#3498db'}
            transparent
            opacity={0.55}
          />
        </mesh>
      )}
    </group>
  );
}

interface RoofPickAdderProps {
  size: [number, number, number];
  others: EditablePanel[];
}

// Listens for click events on the canvas and, if the click hits the GLB roof
// (not an existing panel), validates and adds a new panel at that position.
// Drag clicks (pointer moved while down) are ignored so panel-drag operations
// don't accidentally drop a new panel where the drag ended.
function RoofPickAdder({ size, others }: RoofPickAdderProps) {
  const { gl, camera, raycaster, pointer, scene } = useThree();
  const { validateAt } = useRoofValidator(size);
  const addEditedPanel = useStore((s) => s.addEditedPanel);

  useEffect(() => {
    const dom = gl.domElement;
    let downX = 0;
    let downY = 0;
    let downId = -1;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downId = e.pointerId;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== downId) return;
      // Treat pointer-moves greater than a few px as drags (camera orbit /
      // panel drag) — never spawn a panel from those.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(scene, true);
      if (hits.length === 0) return;
      // Walk the first hit's ancestry: if a panel is in front, it owns the
      // click (delete handler already fired). Only act if the topmost hit is
      // on the GLB roof.
      let node: Object3D | null = hits[0].object;
      let onRoof = false;
      while (node) {
        if (node.userData?.isPanel) return;
        if (node.userData?.isGlbRoof) {
          onRoof = true;
          break;
        }
        node = node.parent;
      }
      if (!onRoof) return;
      const hit = hits[0];
      if (!hit.face) return;
      const worldNormal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      if (worldNormal.y < ROOF_NORMAL_Y_MIN) return;
      const point = hit.point.clone();
      if (!validateAt(point, worldNormal, others)) return;
      addEditedPanel({
        id: `manual_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        x: point.x,
        y: point.y,
        z: point.z,
        normal: [worldNormal.x, worldNormal.y, worldNormal.z],
      });
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, raycaster, pointer, scene, validateAt, others, addEditedPanel]);

  return null;
}
