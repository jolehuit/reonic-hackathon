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

// Custom address selected via Google Places Autocomplete on landing.
// Other devs (B = backend, A = scene, D = geometry) read this when
// `selectedHouse === 'custom'` to drive their own runtime pipeline.
export interface CustomAddress {
  formatted: string;          // e.g. "12 Lindenstraße, 14467 Brandenburg, Germany"
  lat: number;
  lng: number;
  placeId?: string;           // Google place_id, for caching/dedup if needed
  countryCode?: string;       // ISO 3166-1 alpha-2 (e.g. "DE")
}

// Manual questionnaire inputs (only meaningful when selectedHouse === 'custom')
// Mirrors the Reonic onboarding flow exactly.
export type CalculateBy = 'usage' | 'cost';
export type Currency = 'EUR' | 'GBP' | 'USD';
export type HeatingFamily = 'renewable' | 'conventional';
export type PvPackage = 'starter' | 'comfort' | 'premium';
export type BatteryPackage = 'starter' | 'comfort' | 'premium';
export type ChargerPackage = 'comfort';

export interface ManualInputs {
  // Energy consumption
  calculateBy: CalculateBy;
  consumptionKwh: number;        // residential consumption
  inhabitants: number;           // 1-4+ (people selector)
  electricityPrice: number;      // p/kWh or cents/kWh
  currency: Currency;
  annualIncreasePct: number;     // default 3
  timeOfUsePrices: boolean;
  // Existing solar
  hasSolar: boolean | null;
  // Heating
  heatingFamily: HeatingFamily | null;
  // EV
  hasEv: boolean | null;
  evModel?: string;              // free text e.g. "Elaris · Beo"
  evAnnualKm?: number;
  // EV Charger
  hasEvCharger: boolean | null;
  // PV package selection (Reonic offer step)
  selectedPackage: PvPackage | null;
  selectedBattery: BatteryPackage | null;
  selectedCharger: ChargerPackage | null;
  // Section completion flags (controls Save → collapsed summary)
  saved: {
    energy: boolean;
    solar: boolean;
    heating: boolean;
    ev: boolean;
    charger: boolean;
  };
}

interface AppState {
  // Phase
  phase: AppPhase;
  setPhase: (phase: AppPhase) => void;

  // House selection — either a demo HouseId or 'custom' for an arbitrary address.
  selectedHouse: HouseId | 'custom' | null;
  selectHouse: (id: HouseId | 'custom') => void;

  // Custom address (only meaningful when selectedHouse === 'custom')
  customAddress: CustomAddress | null;
  setCustomAddress: (a: CustomAddress | null) => void;

  // Manual questionnaire inputs (custom address flow)
  manualInputs: ManualInputs;
  updateManualInput: <K extends keyof ManualInputs>(
    key: K,
    value: ManualInputs[K],
  ) => void;
  saveManualSection: (section: keyof ManualInputs['saved']) => void;
  resetManualInputs: () => void;

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

const defaultManualInputs: ManualInputs = {
  calculateBy: 'usage',
  consumptionKwh: 3500,
  inhabitants: 3,
  electricityPrice: 35,
  currency: 'EUR',
  annualIncreasePct: 3,
  timeOfUsePrices: false,
  hasSolar: null,
  heatingFamily: null,
  hasEv: null,
  evModel: undefined,
  evAnnualKm: 15000,
  hasEvCharger: null,
  selectedPackage: null,
  selectedBattery: null,
  selectedCharger: null,
  saved: {
    energy: false,
    solar: false,
    heating: false,
    ev: false,
    charger: false,
  },
};

export const useStore = create<AppState>((set) => ({
  phase: 'idle',
  setPhase: (phase) => set({ phase }),

  selectedHouse: null,
  selectHouse: (id) => set({ selectedHouse: id, phase: 'house-selected' }),

  customAddress: null,
  setCustomAddress: (customAddress) => set({ customAddress }),

  manualInputs: defaultManualInputs,
  updateManualInput: (key, value) =>
    set((s) => ({ manualInputs: { ...s.manualInputs, [key]: value } })),
  saveManualSection: (section) =>
    set((s) => ({
      manualInputs: {
        ...s.manualInputs,
        saved: { ...s.manualInputs.saved, [section]: true },
      },
    })),
  resetManualInputs: () => set({ manualInputs: defaultManualInputs }),

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
      customAddress: null,
      manualInputs: defaultManualInputs,
      profile: null,
      refinements: defaultRefinements,
      design: null,
      agentSteps: [],
    }),
}));
