// Animation orchestrator — OWNED by Dev A (paired with Dev C on store)
// Runs the agent sequence: 22s of step-by-step animations synced with AgentTrace text.

'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { AgentStep } from '@/lib/types';

const SEQUENCE: Omit<AgentStep, 'status'>[] = [
  { id: 'load', label: 'Loading photogrammetry model...', durationMs: 2000 },
  { id: 'scan', label: 'Scanning roof geometry...', durationMs: 1500 },
  { id: 'faces', label: '4 roof faces detected', durationMs: 1500 },
  { id: 'obstructions', label: 'Obstructions: 1 chimney, 1 dormer', durationMs: 1000 },
  { id: 'yield', label: 'Computing solar yield (8760h × shadows)...', durationMs: 3000 },
  { id: 'optimal', label: 'Optimal face: SSW 195°, 47m², 1180 kWh/m²/yr', durationMs: 1500 },
  { id: 'pioneer', label: 'Pioneer inference (Reonic-native)...', durationMs: 500 },
  { id: 'predicted', label: 'Predicted in 47ms (vs Gemini 820ms baseline)', durationMs: 500 },
  { id: 'panels', label: 'Placing 24× JA Solar 440W modules...', durationMs: 2000 },
  { id: 'inverter', label: 'Selecting inverter: Sungrow SH10.0RT (95% load)', durationMs: 1500 },
  { id: 'battery', label: 'Sizing battery: BYD 6.3 kWh', durationMs: 2000 },
  { id: 'hp', label: 'Adding heat pump: Vaillant aroTHERM', durationMs: 1500 },
  { id: 'pricing', label: 'Computing BOM + pricing...', durationMs: 1500 },
  { id: 'total', label: 'Total: €11,400 · Payback 9.4 yrs', durationMs: 1500 },
  { id: 'ready', label: 'Ready. Refine below ↓', durationMs: 0 },
];

export function Orchestrator() {
  const phase = useStore((s) => s.phase);
  const profile = useStore((s) => s.profile);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const setAgentSteps = useStore((s) => s.setAgentSteps);
  const updateStepStatus = useStore((s) => s.updateStepStatus);
  const setPhase = useStore((s) => s.setPhase);
  const setDesign = useStore((s) => s.setDesign);

  useEffect(() => {
    if (phase !== 'agent-running' || !profile || !selectedHouse) return;

    const steps: AgentStep[] = SEQUENCE.map((s) => ({ ...s, status: 'pending' }));
    setAgentSteps(steps);

    let cancelled = false;

    // Fire the actual /api/design call in parallel with the visible animation.
    // Whoever lands first wins; we wait for both before transitioning to interactive.
    const designPromise = fetch('/api/design', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile, houseId: selectedHouse }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    (async () => {
      for (const step of steps) {
        if (cancelled) return;
        updateStepStatus(step.id, 'running');
        // TODO Dev A: trigger 3D animation per step (camera dive, wireframe sweep, panels drop, etc.)
        await new Promise((r) => setTimeout(r, step.durationMs));
        updateStepStatus(step.id, 'done');
      }
      const design = await designPromise;
      if (cancelled) return;
      if (design) setDesign(design);
      setPhase('interactive');
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, profile, selectedHouse, setAgentSteps, updateStepStatus, setPhase, setDesign]);

  return null;
}
