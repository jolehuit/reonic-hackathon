// Zustand state machine — OWNED by Dev C
// Read freely from anywhere. Writes only via the action methods below.

import { create } from 'zustand';
import type {
  AppPhase,
  HouseId,
  CustomerProfile,
  DesignRefinements,
  DesignResult,
  RoofGeometry,
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

export type TrellisStatus = 'idle' | 'generating' | 'ready' | 'error';

interface AppState {
  // Phase
  phase: AppPhase;
  setPhase: (phase: AppPhase) => void;

  // Trellis (image-to-3D) generation status. Written by Orchestrator as it
  // walks the capture → clean → trellis chain; read by TrellisModel (which
  // shows the GLB once ready) and the design page overlays (which only
  // mount once the scene is interactive).
  trellisStatus: TrellisStatus;
  setTrellisStatus: (s: TrellisStatus) => void;

  // URL of the generated GLB (set by Orchestrator when fal-ai/trellis
  // returns). TrellisModel watches this to load the mesh into the scene.
  glbUrl: string | null;
  setGlbUrl: (u: string | null) => void;

  /** Set to `true` by <LoadedGlb/> after the GLTFLoader has finished
   *  loading the mesh. Means the GLB is parsed and mounted, but the
   *  skeleton→GLB cross-fade may still be running. */
  glbLoaded: boolean;
  setGlbLoaded: (v: boolean) => void;

  /** Set to `true` by <MorphingBuilding/> after the skeleton→GLB cross-fade
   *  is COMPLETE and the GLB is fully visible at scale 1.0. This is the
   *  signal the panel-drop animation gates on — guarantees we never start
   *  laying panels onto a still-morphing or invisible roof. */
  glbStable: boolean;
  setGlbStable: (v: boolean) => void;

  /** Rendered Y height of the GLB after the uniform XZ scale applied by
   *  <LoadedGlb/>. Used by <HouseGeometryProvider/> to rescale baked panel
   *  positions onto the actual roof — different houses have different roof
   *  pitches, so the analysis.json baseline doesn't match the GLB by default. */
  glbHeight: number | null;
  setGlbHeight: (v: number | null) => void;

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

  /**
   * Number of panels currently revealed in the placement animation. Starts
   * at 0 once the imagery + sizing lanes have settled, then ticks up to
   * `design.modulePositions.length` over a few seconds. <Panels/> slices the
   * positions array by this count so only the first N panels render.
   */
  placedCount: number;
  setPlacedCount: (n: number) => void;

  // Roof geometry — usually loaded from /baked/{houseId}-analysis.json by
  // HouseGeometryProvider. For custom addresses, /api/design synthesises one
  // and we stash it here so the Scene3D consumes it directly.
  customRoofGeometry: RoofGeometry | null;
  setCustomRoofGeometry: (g: RoofGeometry | null) => void;

  // Agent sequence
  agentSteps: AgentStep[];
  setAgentSteps: (s: AgentStep[]) => void;
  updateStepStatus: (id: string, status: AgentStep['status']) => void;
  /** Patch any subset of fields on a single step (artifactUrl, resultLine, …). */
  updateStepFields: (id: string, fields: Partial<AgentStep>) => void;

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

  trellisStatus: 'idle',
  setTrellisStatus: (trellisStatus) => set({ trellisStatus }),

  glbUrl: null,
  setGlbUrl: (glbUrl) =>
    set({ glbUrl, glbLoaded: false, glbStable: false, glbHeight: null }),

  glbLoaded: false,
  setGlbLoaded: (glbLoaded) => set({ glbLoaded }),

  glbStable: false,
  setGlbStable: (glbStable) => set({ glbStable }),

  glbHeight: null,
  setGlbHeight: (glbHeight) => set({ glbHeight }),

  selectedHouse: null,
  selectHouse: (id) =>
    set({ selectedHouse: id, phase: 'house-selected', trellisStatus: 'idle', glbUrl: null }),

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

  placedCount: 0,
  setPlacedCount: (placedCount) => set({ placedCount }),

  customRoofGeometry: null,
  setCustomRoofGeometry: (customRoofGeometry) => set({ customRoofGeometry }),

  agentSteps: [],
  setAgentSteps: (agentSteps) => set({ agentSteps }),
  updateStepStatus: (id, status) =>
    set((s) => ({
      agentSteps: s.agentSteps.map((step) =>
        step.id === id ? { ...step, status } : step,
      ),
    })),
  updateStepFields: (id, fields) =>
    set((s) => ({
      agentSteps: s.agentSteps.map((step) =>
        step.id === id ? { ...step, ...fields } : step,
      ),
    })),

  reset: () =>
    set({
      phase: 'idle',
      trellisStatus: 'idle',
      glbUrl: null,
      selectedHouse: null,
      customAddress: null,
      manualInputs: defaultManualInputs,
      profile: null,
      refinements: defaultRefinements,
      design: null,
      customRoofGeometry: null,
      agentSteps: [],
      placedCount: 0,
      glbLoaded: false,
      glbStable: false,
      glbHeight: null,
    }),
}));
