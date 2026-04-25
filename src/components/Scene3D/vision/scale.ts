// Vertical rescaling helpers — OWNED by Dev A
// analysis.json is baked at a 3 m wall height. When VisionParams says the
// building is multi-storey, Y coordinates (roof faces, panel positions,
// chimneys) need to be rescaled to land on the new geometry.

import type { VisionParams } from './visionTypes';

export const ORIGINAL_WALL_TOP = 3;
export const STOREY_HEIGHT = 2.7;

export function effectiveWallHeight(params: VisionParams | null): number {
  return params ? params.storeyCount * STOREY_HEIGHT : ORIGINAL_WALL_TOP;
}

/**
 * Map a Y coordinate from the original 3 m baseline into the AI-driven
 * effective geometry. Wall-level points scale linearly; ridge points
 * preserve the rise above the wall top.
 */
export function rescaleY(originalY: number, params: VisionParams | null): number {
  if (!params) return originalY;
  const newWall = effectiveWallHeight(params);
  if (originalY <= ORIGINAL_WALL_TOP) {
    return (originalY / ORIGINAL_WALL_TOP) * newWall;
  }
  const rise = originalY - ORIGINAL_WALL_TOP;
  return newWall + rise;
}
