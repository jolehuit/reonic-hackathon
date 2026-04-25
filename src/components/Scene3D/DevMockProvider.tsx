// Dev-only mock seeder — OWNED by Dev A
// Pushes mock profile/design into the zustand store so the 3D pipeline can be
// tested in full before Dev B (API), Dev C (form/orchestrator) and Dev D
// (analysis.json) have pushed their work.
//
// Activation: NODE_ENV === 'development' AND URL has ?mock=<mode>.
// Modes:
//   ?mock=1 or ?mock=interactive → skip flow, go straight to interactive scene
//   ?mock=ready                  → fill profile, wait at ready-to-design (lets you click Generate)
//   ?mock=agent                  → fill profile, kick off the 22s orchestrator sequence
//
// Robustness: DesignPage runs `selectHouse(houseId)` in a useEffect that fires
// AFTER children effects, which would normally reset our mock phase back to
// 'house-selected' and re-summon the popup. We subscribe to the store and
// re-apply the mock whenever the phase regresses to a popup phase.
//
// Production safety: gated behind process.env.NODE_ENV check + ?mock= param.

'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { HouseId } from '@/lib/types';
import { MOCK_DESIGN, MOCK_PROFILES } from './dev-mocks';

interface Props {
  houseId: HouseId;
}

type MockMode = 'interactive' | 'ready' | 'agent';

const POPUP_PHASES = new Set(['idle', 'house-selected', 'autofilling', 'ready-to-design']);

function readMockMode(): MockMode | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('mock');
  if (!raw) return null;
  if (raw === '1' || raw === 'interactive') return 'interactive';
  if (raw === 'ready') return 'ready';
  if (raw === 'agent') return 'agent';
  return null;
}

export function DevMockProvider({ houseId }: Props) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const mode = readMockMode();
    if (!mode) return;

    const profile = MOCK_PROFILES[houseId];

    const apply = () => {
      if (mode === 'interactive') {
        useStore.setState({
          selectedHouse: houseId,
          profile,
          phase: 'interactive',
          design: MOCK_DESIGN,
        });
      } else if (mode === 'ready') {
        useStore.setState({
          selectedHouse: houseId,
          profile,
          phase: 'ready-to-design',
        });
      } else if (mode === 'agent') {
        useStore.setState({
          selectedHouse: houseId,
          profile,
          phase: 'agent-running',
          design: MOCK_DESIGN,
        });
      }
    };

    // Initial apply (will likely be overridden by DesignPage's selectHouse below).
    apply();

    // Re-apply whenever phase regresses to a popup phase.
    // Note: 'ready' mode legitimately wants to sit at ready-to-design, so we
    // only re-apply if we drift OFF the target — otherwise we'd loop.
    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.phase === prevState.phase) return;
      if (mode === 'interactive' && POPUP_PHASES.has(state.phase)) apply();
      else if (mode === 'agent' && POPUP_PHASES.has(state.phase)) apply();
      else if (mode === 'ready' && state.phase !== 'ready-to-design' && POPUP_PHASES.has(state.phase)) {
        apply();
      }
    });

    return unsubscribe;
  }, [houseId]);

  return null;
}
