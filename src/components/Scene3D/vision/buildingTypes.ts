// Building description types — OWNED by Dev A
// Output of the Gemini Vision agent. Rich enough that the renderer is just
// an instancer: it converts these declarative facts into Three.js meshes
// without making any architectural decisions of its own. The AI is the
// architect; the code only matérialises.

export type FacadeOrientation = 'north' | 'south' | 'east' | 'west';
export type RoofType = 'gable' | 'hip' | 'flat' | 'mansard' | 'shed';
export type RidgeAxis = 'x' | 'z';
export type FacadeMaterial = 'render' | 'brick' | 'wood' | 'stone';
export type OpeningType = 'window' | 'door' | 'garage_door';
export type WindowStyle = 'rectangular' | 'square' | 'arched' | 'french-window';
export type RoofFeatureType = 'chimney' | 'dormer' | 'skylight';
export type Visibility = 'clear' | 'partial' | 'obscured';
export type VolumeRole = 'main' | 'garage' | 'extension';

export interface Opening {
  type: OpeningType;
  /** Floor index, 0 = ground floor. */
  storey: number;
  /** 0 = left edge of facade, 1 = right edge. */
  horizontalPosition: number;
  width: number;
  height: number;
  style: WindowStyle;
  hasShutters: boolean;
}

export interface Facade {
  orientation: FacadeOrientation;
  visibility: Visibility;
  openings: Opening[];
}

export interface RoofFeature {
  type: RoofFeatureType;
  /** X position (east-west) in meters relative to the volume's center. */
  positionX: number;
  /** Z position (north-south) in meters relative to the volume's center. */
  positionZ: number;
  width: number;
  heightAboveRoof: number;
  depth: number;
}

export interface Roof {
  type: RoofType;
  /** Roof pitch in degrees. 0 for flat. */
  pitchDeg: number;
  /** x = east-west ridge, z = north-south ridge. */
  ridgeAxis: RidgeAxis;
  color: string;
  /** Eaves overhang in meters. */
  overhangM: number;
  features: RoofFeature[];
}

export interface Volume {
  role: VolumeRole;
  /** Volume center X (east-west). Relative to main building origin. */
  centerX: number;
  /** Volume center Z (north-south). Relative to main building origin. */
  centerZ: number;
  /** East-west width in meters. */
  width: number;
  /** North-south depth in meters. */
  depth: number;
  storeyCount: number;
  /** Per-storey height in meters. */
  storeyHeightM: number;
  wallColor: string;
  facadeMaterial: FacadeMaterial;
  roof: Roof;
  /** Exactly 4 facades — one per cardinal orientation. */
  facades: Facade[];
}

/** Annotation describing what data sources contributed to the description. */
export interface DataSources {
  geminiVision: boolean;
  osmFootprint: {
    osmId: number;
    /** Polygon in mesh-local meters relative to the address, closed. */
    polygonMeshXZ: [number, number][];
    centroidOffset: { east: number; north: number };
    levelsTag?: number;
    heightTag?: number;
    roofShapeTag?: string;
  } | null;
}

export interface BuildingDescription {
  description: string;
  volumes: Volume[];
  trimColor: string;
  /** Provenance — null when not used. */
  sources: DataSources;
}
