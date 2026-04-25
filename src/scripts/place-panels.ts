// Panel placement algorithm — OWNED by Dev D
// Given a roof face + obstructions + module size, return panel positions on a grid.

import type { RoofFace, Obstruction } from '@/lib/types';

const MODULE_WIDTH_M = 1.7;
const MODULE_HEIGHT_M = 1.0;
const EDGE_OFFSET_M = 0.5;
const MODULE_GAP_M = 0.05;

export function placePanelsOnFace(
  face: RoofFace,
  obstructions: Obstruction[],
  maxModules?: number,
): { x: number; y: number; z: number; faceId: number }[] {
  // TODO Dev D:
  // 1. Project face polygon to 2D (local frame from normal)
  // 2. Apply edge offset (shrink polygon by EDGE_OFFSET_M)
  // 3. Generate grid of module centers (MODULE_WIDTH_M + GAP, MODULE_HEIGHT_M + GAP)
  // 4. Filter cells inside polygon AND outside obstruction radii
  // 5. If maxModules set, take top-N by yield (read from baked yield)
  // 6. Re-project back to 3D world coords using face normal + plane equation
  return [];
}
