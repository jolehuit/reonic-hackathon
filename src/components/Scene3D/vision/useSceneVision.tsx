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
  refresh: () => void;
}

const Ctx = createContext<VisionContextValue | null>(null);

interface ProviderProps {
  houseId: HouseId;
  analysis: RoofGeometry | null;
  mode: AnalysisMode;
  /** Auto-trigger on mount and on houseId/mode change. Default true. */
  autoRun?: boolean;
  children: ReactNode;
}

export function SceneVisionProvider({
  houseId,
  analysis,
  mode,
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
    const coords = HOUSE_COORDS[houseId];
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
  }, [houseId, mode]);

  useEffect(() => {
    if (!autoRun) return;
    queueMicrotask(() => {
      void run();
    });
    return () => {
      inflight.current = null;
    };
  }, [autoRun, run]);

  const value = useMemo<VisionContextValue>(
    () => ({
      status,
      building: status.kind === 'ready' ? status.building : null,
      refresh: () => void run(),
    }),
    [status, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSceneVision(): VisionContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { status: { kind: 'idle' }, building: null, refresh: () => {} };
  }
  return ctx;
}
