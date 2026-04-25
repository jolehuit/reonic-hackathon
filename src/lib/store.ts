// Zustand state machine — OWNED by Dev C
// Read freely from anywhere. Writes only via the action methods below.

import { create } from 'zustand';
import type {
  AppPhase,
  HouseId,
  CustomerProfile,
  DesignRefinements,
  DesignResult,
  AgentStep,
} from './types';

interface AppState {
  // Phase
  phase: AppPhase;
  setPhase: (phase: AppPhase) => void;

  // House selection
  selectedHouse: HouseId | null;
  selectHouse: (id: HouseId) => void;

  // Customer profile (auto-filled, then editable)
  profile: CustomerProfile | null;
  setProfile: (p: CustomerProfile) => void;
  updateProfileField: <K extends keyof CustomerProfile>(
    key: K,
    value: CustomerProfile[K],
  ) => void;

  // Refinements (post-design)
  refinements: DesignRefinements;
  setRefinement: <K extends keyof DesignRefinements>(
    key: K,
    value: DesignRefinements[K],
  ) => void;

  // Design result (from /api/design)
  design: DesignResult | null;
  setDesign: (d: DesignResult | null) => void;

  // Agent sequence
  agentSteps: AgentStep[];
  setAgentSteps: (s: AgentStep[]) => void;
  updateStepStatus: (id: string, status: AgentStep['status']) => void;

  // Reset
  reset: () => void;
}

const defaultRefinements: DesignRefinements = {
  includeBattery: true,
  includeHeatPump: true,
  includeWallbox: false,
};

export const useStore = create<AppState>((set) => ({
  phase: 'idle',
  setPhase: (phase) => set({ phase }),

  selectedHouse: null,
  selectHouse: (id) => set({ selectedHouse: id, phase: 'house-selected' }),

  profile: null,
  setProfile: (profile) => set({ profile }),
  updateProfileField: (key, value) =>
    set((s) => ({ profile: s.profile ? { ...s.profile, [key]: value } : null })),

  refinements: defaultRefinements,
  setRefinement: (key, value) =>
    set((s) => ({ refinements: { ...s.refinements, [key]: value } })),

  design: null,
  setDesign: (design) => set({ design }),

  agentSteps: [],
  setAgentSteps: (agentSteps) => set({ agentSteps }),
  updateStepStatus: (id, status) =>
    set((s) => ({
      agentSteps: s.agentSteps.map((step) =>
        step.id === id ? { ...step, status } : step,
      ),
    })),

  reset: () =>
    set({
      phase: 'idle',
      selectedHouse: null,
      profile: null,
      refinements: defaultRefinements,
      design: null,
      agentSteps: [],
    }),
}));
