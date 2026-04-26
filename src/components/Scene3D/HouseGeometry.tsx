// Shared house geometry context — OWNED by Dev A
// Loads public/baked/{houseId}-analysis.json once and exposes the building
// footprint, wall height, roof faces and obstructions to every Scene3D child.
//
// For custom addresses (`houseId === 'custom'`), the geometry comes from the
// store (set by Orchestrator after /api/design responds with a synthetic
// RoofGeometry — cf src/lib/customRoof.ts).
//
// All energy components (Inverter, Battery, HeatPump, Wallbox) read their
// position from this context so they always sit flush against the actual
// house walls — even when Dev D ships new analysis.json files with different
// dimensions for Hamburg / Ruhr.

'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '@/lib/store';
import type { HouseId, Obstruction, RoofFace, RoofGeometry } from '@/lib/types';

const DEFAULT_SIZE: readonly [number, number, number] = [7, 6, 5];
const DEFAULT_WALL_HEIGHT = 3;

export interface HouseGeometryValue {
  houseId: HouseId | 'custom';
  width: number;
  depth: number;
  wallHeight: number;
  /** Half-extents — wall surface lies at ±halfWidth on x and ±halfDepth on z. */
  halfWidth: number;
  halfDepth: number;
  faces: RoofFace[];
  obstructions: Obstruction[];
  modulePositions: NonNullable<RoofGeometry['modulePositions']>;
  /** Raw analysis JSON exposed for downstream consumers (e.g. vision pipeline) */
  analysis: RoofGeometry | null;
  loaded: boolean;
}

const Ctx = createContext<HouseGeometryValue | null>(null);

export function HouseGeometryProvider({
  houseId,
  children,
}: {
  houseId: HouseId | 'custom';
  children: ReactNode;
}) {
  const customGeometry = useStore((s) => s.customRoofGeometry);
  const glbHeight = useStore((s) => s.glbHeight);
  const [bakedAnalysis, setBakedAnalysis] = useState<RoofGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (houseId === 'custom') {
      // Drop any previous demo-house bake on the next microtask — never
      // synchronously inside the effect body.
      queueMicrotask(() => {
        if (!cancelled) setBakedAnalysis(null);
      });
      return () => {
        cancelled = true;
      };
    }
    fetch(`/baked/${houseId}-analysis.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RoofGeometry | null) => {
        if (cancelled) return;
        setBakedAnalysis(data);
      })
      .catch(() => {
        if (!cancelled) setBakedAnalysis(null);
      });
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  const analysis = houseId === 'custom' ? customGeometry : bakedAnalysis;

  const value = useMemo<HouseGeometryValue>(() => {
    const size = analysis?.buildingFootprint?.size ?? DEFAULT_SIZE;
    const width = size[0];
    const depth = size[2];

    // Photogrammetry-derived analysis files (the demo houses) carry vertices
    // and panel positions in *absolute world altitude* (Y often near 100m
    // because the bakery used real ECEF-ish coords). The TrellisModel
    // recentres the GLB to (0, 0, 0), so we mirror that on the geometry side
    // by subtracting buildingFootprint.center and dropping the model onto
    // y=0. Without this, panels render at altitude 100m+ — visually
    // detached from the roof. Synthesised geometry (custom addresses) is
    // already in local space, so we treat its center as a no-op.
    const center = analysis?.buildingFootprint?.center ?? [0, 0, 0];
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    // The baked Y range (after centering) is [-bakedHalfH, +bakedHalfH], so
    // the building's total height in baked space is `size[1]`. The GLB
    // renders at a different scaled height (`glbHeight`, published by
    // <LoadedGlb/>), because each Trellis run produces its own pitch.
    // Rescale baked Y to fit the actual GLB so panels land on the visible
    // roof, not above or inside it.
    const bakedHeight = Math.max(size[1], 0.001);
    const yScale = glbHeight && glbHeight > 0 ? glbHeight / bakedHeight : 1;
    const targetHeight = glbHeight && glbHeight > 0 ? glbHeight : bakedHeight;
    const halfHeight = targetHeight / 2;

    // y in baked frame → recentre around 0 → scale to GLB → drop onto y=0.
    const recenterY = (y: number): number =>
      (y - cy) * yScale + halfHeight;

    const faces = (analysis?.faces ?? []).map((face) => ({
      ...face,
      vertices: face.vertices.map((v) => [
        v[0] - cx,
        recenterY(v[1]),
        v[2] - cz,
      ]),
    }));
    const obstructions = (analysis?.obstructions ?? []).map((ob) => ({
      ...ob,
      position: [
        ob.position[0] - cx,
        recenterY(ob.position[1]),
        ob.position[2] - cz,
      ] as [number, number, number],
    }));
    const modulePositions = (analysis?.modulePositions ?? []).map((p) => ({
      ...p,
      x: p.x - cx,
      y: recenterY(p.y),
      z: p.z - cz,
    }));

    return {
      houseId,
      width,
      depth,
      wallHeight: DEFAULT_WALL_HEIGHT,
      halfWidth: width / 2,
      halfDepth: depth / 2,
      faces,
      obstructions,
      modulePositions,
      analysis,
      loaded: analysis !== null,
    };
  }, [analysis, houseId, glbHeight]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHouseGeometry(): HouseGeometryValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      houseId: 'brandenburg',
      width: DEFAULT_SIZE[0],
      depth: DEFAULT_SIZE[2],
      wallHeight: DEFAULT_WALL_HEIGHT,
      halfWidth: DEFAULT_SIZE[0] / 2,
      halfDepth: DEFAULT_SIZE[2] / 2,
      faces: [],
      obstructions: [],
      modulePositions: [],
      analysis: null,
      loaded: false,
    };
  }
  return ctx;
}
