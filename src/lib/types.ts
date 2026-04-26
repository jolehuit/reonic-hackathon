// Shared TS contracts — owned jointly by Dev B (backend) and Dev C (UI)
// Pair sync sam 12h. After that, this file is FROZEN unless team-wide change.

// IDs used as URL slugs and storage keys for the three demo addresses.
// Geographic — match the actual neighbourhood each address sits in
// (the previous IDs `brandenburg / hamburg / ruhr` were misleading:
// brandenburg's address was in Berlin-Dahlem, hamburg's was in
// Potsdam-Golm, ruhr's was in Berlin-Karow).
export type HouseId = 'berlin-dahlem' | 'potsdam-golm' | 'berlin-karow';

export type HeatingType = 'oil' | 'gas' | 'heatpump' | 'other';

// Customer profile inputs (auto-filled then editable)
export interface CustomerProfile {
  annualConsumptionKwh: number; // e.g. 4500
  inhabitants: number;          // 1-6
  hasEv: boolean;
  evAnnualKm?: number;          // e.g. 15000
  heatingType: HeatingType;
  houseSizeSqm: number;
  isJumelee: boolean;           // semi-detached (Doppelhaus): roof shared with neighbour → /api/design divides usable area by 2
}

// Refinement toggles (post-design)
export interface DesignRefinements {
  includeBattery: boolean;
  includeHeatPump: boolean;
  includeWallbox: boolean;
}

// Roof geometry (pre-baked offline by Dev D)
export interface RoofFace {
  id: number;
  normal: [number, number, number];
  area: number;          // m² — raw geometric area (sum of triangle areas in the cluster)
  usableArea: number;    // m² — area minus obstruction footprints with safety margin
  azimuth: number;       // 0-360°
  tilt: number;          // degrees
  vertices: number[][];  // polygon
  yieldKwhPerSqm: number; // annual
}

export interface Obstruction {
  id: string;
  type: 'chimney' | 'dormer' | 'vent';
  position: [number, number, number];
  radius: number;
}

export interface RoofGeometry {
  houseId: HouseId;
  faces: RoofFace[];
  obstructions: Obstruction[];
  modulePositions?: { x: number; y: number; z: number; faceId: number }[];
  buildingFootprint?: {
    center: [number, number, number];
    size: [number, number, number];
  };
  // Top-level summary fields written by analyze-roof.ts / analyze-multi.ts
  // so /api/design can read them without iterating arrays. modulesMax is
  // the post-variant-selection physical capacity of the roof.
  modulesMax?: number;
  modulesMaxAreaSqm?: number;
  roofTotalAreaSqm?: number;
  roofUsableAreaSqm?: number;
}

// AI design output
export interface DesignResult {
  // Modules
  moduleCount: number;
  moduleBrand: 'AIKO' | 'Trina';
  moduleWattPeak: number;
  totalKwp: number;
  modulePositions: { x: number; y: number; z: number; faceId: number }[];

  // Inverter
  inverterModel: string;
  inverterPowerKw: number;
  inverterLoadPercent: number;

  // Battery
  batteryCapacityKwh: number | null; // null if not recommended
  batteryBrand: string;

  // Heat pump
  heatPumpModel: string | null;
  heatPumpNominalPowerKw: number | null;

  // Wallbox
  wallboxChargeSpeedKw: number | null;

  // Financials
  totalPriceEur: number;
  paybackYears: number;
  co2SavedTonsPer25y: number;
  /** Share of generated kWh consumed on-site (0–1). Depends on whether the
   *  design includes a battery, a heat pump and/or an EV. Surfaced so the
   *  KPI sidebar can show a real "own consumption" tile instead of a
   *  hardcoded constant. */
  selfConsumptionRatio: number;

  // Reonic Evidence
  similarProjects: SimilarProject[];
  deltaVsMedian: {
    kwp: number;          // signed
    batteryKwh: number;
    priceEur: number;
  };

  // Provenance
  source: 'knn';
  inferenceMs: number;
  /** True when served from the disk cache (public/cache/design/). */
  cacheHit?: boolean;

  /**
   * Roof geometry the design was computed against. Demo houses serve their
   * baked file via HouseGeometryProvider; for custom addresses, /api/design
   * synthesises one and returns it here so the Scene3D can render panels
   * without an extra fetch.
   */
  geometry?: RoofGeometry;
}

export interface SimilarProject {
  projectId: string;
  energyDemandKwh: number;
  hasEv: boolean;
  totalKwp: number;
  batteryKwh: number;
  priceEur: number;
}

// Agent sequence step (Orchestrator)
export type AgentStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentStep {
  id: string;
  label: string;
  status: AgentStepStatus;
  /** Estimated duration in ms (used for the progress bar; the real wall
   *  clock can exceed it — running state lasts until the underlying promise
   *  resolves). */
  durationMs: number;
  /** Optional one-line subtitle shown under the label. */
  sublabel?: string;
  /** Optional URL of an image artifact (e.g. the captured screenshot) shown
   *  as a thumbnail next to the step once status === 'done'. */
  artifactUrl?: string;
  /** Optional one-line summary set when the step completes (e.g. "9.2 kWp"). */
  resultLine?: string;
}

// Global app state machine phases
export type AppPhase =
  | 'idle'             // initial, no house selected
  | 'house-selected'   // house picked, autofill not yet started
  | 'autofilling'      // autofill form typewriter running
  | 'ready-to-design'  // form filled, awaiting Generate click
  | 'agent-running'    // 22s sequence playing
  | 'interactive'      // user can refine
  | 'reviewing'        // HITL modal open
  | 'approved';        // PDF exported
