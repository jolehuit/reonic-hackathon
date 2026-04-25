// Shared house geometry context — OWNED by Dev A
// Loads public/baked/{houseId}-analysis.json once and exposes the building
// footprint, wall height, roof faces and obstructions to every Scene3D child.
//
// All energy components (Inverter, Battery, HeatPump, Wallbox) read their
// position from this context so they always sit flush against the actual
// house walls — even when Dev D ships new analysis.json files with different
// dimensions for Hamburg / Ruhr.

'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { HouseId, Obstruction, RoofFace, RoofGeometry } from '@/lib/types';

const DEFAULT_SIZE: readonly [number, number, number] = [7, 6, 5];
const DEFAULT_WALL_HEIGHT = 3;

export interface HouseGeometryValue {
  houseId: HouseId;
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
  houseId: HouseId;
  children: ReactNode;
}) {
  const [analysis, setAnalysis] = useState<RoofGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/baked/${houseId}-analysis.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RoofGeometry | null) => {
        if (cancelled) return;
        setAnalysis(data);
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null);
      });
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  const value = useMemo<HouseGeometryValue>(() => {
    const size = analysis?.buildingFootprint?.size ?? DEFAULT_SIZE;
    const width = size[0];
    const depth = size[2];
    return {
      houseId,
      width,
      depth,
      wallHeight: DEFAULT_WALL_HEIGHT,
      halfWidth: width / 2,
      halfDepth: depth / 2,
      faces: analysis?.faces ?? [],
      obstructions: analysis?.obstructions ?? [],
      modulePositions: analysis?.modulePositions ?? [],
      analysis,
      loaded: analysis !== null,
    };
  }, [analysis, houseId]);

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
