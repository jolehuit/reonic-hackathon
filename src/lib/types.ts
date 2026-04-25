// Shared TS contracts — owned jointly by Dev B (backend) and Dev C (UI)
// Pair sync sam 12h. After that, this file is FROZEN unless team-wide change.

export type HouseId = 'brandenburg' | 'hamburg' | 'ruhr';

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
  durationMs: number;
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
