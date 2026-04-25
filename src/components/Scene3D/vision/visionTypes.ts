// Vision pipeline types — OWNED by Dev A
// VisionParams is the contract between Gemini Vision (server action) and the
// procedural model generator (StylizedHouse). Stable across the pipeline.

export type RoofType = 'gable' | 'hip' | 'flat' | 'mansard';
export type FacadeMaterial = 'render' | 'brick' | 'wood' | 'stone';
export type WindowStyle = 'rectangular' | 'square' | 'arched';
export type DoorPosition = 'center' | 'left' | 'right';
export type RidgeOrientation = 'eastwest' | 'northsouth';

export interface VisionParams {
  storeyCount: number;
  wallColor: string;
  roofColor: string;
  trimColor: string;
  roofType: RoofType;
  facadeMaterial: FacadeMaterial;
  hasBalcony: boolean;
  hasDormer: boolean;
  hasChimney: boolean;
  windowsPerFacade: number;
  windowStyle: WindowStyle;
  doorPosition: DoorPosition;
  hasGarage: boolean;
  ridgeOrientation: RidgeOrientation;
  roofOverhang: number;
  notes: string;
}

/**
 * Sensible defaults used when the Gemini call hasn't completed (or has
 * failed). Keep aligned with what the procedural model expects so that
 * the scene renders coherently in the absence of AI output.
 */
export const DEFAULT_VISION_PARAMS: VisionParams = {
  storeyCount: 2,
  wallColor: '#ece4d4',
  roofColor: '#a04a3a',
  trimColor: '#ffffff',
  roofType: 'gable',
  facadeMaterial: 'render',
  hasBalcony: false,
  hasDormer: false,
  hasChimney: true,
  windowsPerFacade: 4,
  windowStyle: 'rectangular',
  doorPosition: 'center',
  hasGarage: false,
  ridgeOrientation: 'eastwest',
  roofOverhang: 0.4,
  notes: 'Default fallback: typical German suburban gable house.',
};
