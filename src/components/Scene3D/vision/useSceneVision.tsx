// Vision hook + provider — OWNED by Dev A
// The mode determines which source feeds the BuildingDescription:
//   - 'gemini'      : Gemini Vision only (current default)
//   - 'osm-hybrid'  : OSM footprint + Gemini Vision details

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HouseId, RoofGeometry } from '@/lib/types';
import { HOUSE_COORDS } from './houseLatLng';
import { analyzeBuilding, type AnalysisMode } from './sceneVisionAction';
import type { BuildingDescription } from './buildingTypes';
import { DEFAULT_VISION_PARAMS, type VisionParams } from './visionTypes';

export type VisionStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      building: BuildingDescription;
      inferenceMs: number;
      capturesUsed: number;
      fromCache: boolean;
      mode: AnalysisMode;
    }
  | { kind: 'error'; reason: string; message: string };

interface VisionContextValue {
  status: VisionStatus;
  building: BuildingDescription | null;
  /** Compatibility shim for Panels.tsx (needs storeyCount to rescale Y). */
  params: VisionParams | null;
  refresh: () => void;
}

function deriveParams(building: BuildingDescription | null): VisionParams | null {
  if (!building) return null;
  const main = building.volumes[0];
  if (!main) return null;
  return {
    ...DEFAULT_VISION_PARAMS,
    storeyCount: main.storeyCount,
    wallColor: main.wallColor ?? DEFAULT_VISION_PARAMS.wallColor,
  };
}

const Ctx = createContext<VisionContextValue | null>(null);

interface ProviderProps {
  houseId: HouseId;
  analysis: RoofGeometry | null;
  mode: AnalysisMode;
  /** Override the hardcoded HOUSE_COORDS — used by custom-address flow. */
  coordsOverride?: { lat: number; lng: number; address: string } | null;
  /** Auto-trigger on mount and on houseId/mode change. Default true. */
  autoRun?: boolean;
  children: ReactNode;
}

export function SceneVisionProvider({
  houseId,
  analysis,
  mode,
  coordsOverride,
  autoRun = true,
  children,
}: ProviderProps) {
  const [status, setStatus] = useState<VisionStatus>({ kind: 'idle' });
  const inflight = useRef<symbol | null>(null);
  const analysisRef = useRef(analysis);
  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  const run = useCallback(async () => {
    const coords = coordsOverride ?? HOUSE_COORDS[houseId];
    if (!coords) return;

    const token = Symbol(houseId);
    inflight.current = token;
    setStatus({ kind: 'loading' });

    const result = await analyzeBuilding({
      lat: coords.lat,
      lng: coords.lng,
      address: coords.address,
      analysis: analysisRef.current,
      mode,
    });

    if (inflight.current !== token) return;

    if (result.ok) {
      setStatus({
        kind: 'ready',
        building: result.building,
        inferenceMs: result.inferenceMs,
        capturesUsed: result.capturesUsed,
        fromCache: result.fromCache,
        mode: result.mode,
      });
    } else {
      setStatus({ kind: 'error', reason: result.reason, message: result.message });
    }
  }, [houseId, mode, coordsOverride]);

  useEffect(() => {
    if (!autoRun) return;
    queueMicrotask(() => {
      void run();
    });
    return () => {
      inflight.current = null;
    };
  }, [autoRun, run]);

  const value = useMemo<VisionContextValue>(() => {
    const building = status.kind === 'ready' ? status.building : null;
    return {
      status,
      building,
      params: deriveParams(building),
      refresh: () => void run(),
    };
  }, [status, run]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSceneVision(): VisionContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { status: { kind: 'idle' }, building: null, params: null, refresh: () => {} };
  }
  return ctx;
}
