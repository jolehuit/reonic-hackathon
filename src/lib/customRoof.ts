// Custom-address fallback geometry — OWNED by Dev B (calls into Dev D's panel
// placer). When the jury types an address that we haven't pre-baked offline,
// we synthesise a plausible single-pavilion gable house centred at the origin
// so the demo never falls over. The brief explicitly authorises this:
// "If that's too hard, build something that estimates the space available".

import type { CustomerProfile, RoofGeometry, RoofFace } from './types';

const PITCH_DEG = 35;
const SOUTH_AZIMUTH = 195; // SSW, the German preferred orientation

/**
 * Build a synthetic gable-roof geometry sized to the customer's stated house.
 * Footprint area ≈ houseSizeSqm × 0.6 (leaving ~40% for non-living rooms),
 * aspect ratio 1.4 (typical European house), ridge along the long axis (X).
 */
export function synthesiseRoofGeometry(
  lat: number,
  lng: number,
  houseSizeSqm: number,
): RoofGeometry {
  const footprintArea = Math.max(50, Math.min(220, houseSizeSqm * 0.6));
  const aspect = 1.4;
  const depth = Math.sqrt(footprintArea / aspect);
  const width = depth * aspect;
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallHeight = 3;
  const tiltRad = (PITCH_DEG * Math.PI) / 180;
  const ridgeY = wallHeight + halfD * Math.tan(tiltRad);
  // Two pitched faces, ridge along X axis. Front (+z, south) and back (-z, north).
  const faceArea = (Math.sqrt(halfD * halfD + (ridgeY - wallHeight) ** 2) * width);
  const usableArea = faceArea * 0.85; // 15% margin for chimneys/edges

  const southFace: RoofFace = {
    id: 0,
    normal: [0, Math.cos(tiltRad), Math.sin(tiltRad)],
    area: faceArea,
    usableArea,
    azimuth: SOUTH_AZIMUTH,
    tilt: PITCH_DEG,
    vertices: [
      [-halfW, wallHeight, halfD],
      [halfW, wallHeight, halfD],
      [halfW, ridgeY, 0],
      [-halfW, ridgeY, 0],
    ],
    yieldKwhPerSqm: 1180,
  };
  const northFace: RoofFace = {
    id: 1,
    normal: [0, Math.cos(tiltRad), -Math.sin(tiltRad)],
    area: faceArea,
    usableArea: usableArea * 0.6, // less usable: sun side only
    azimuth: 15,
    tilt: PITCH_DEG,
    vertices: [
      [-halfW, wallHeight, -halfD],
      [halfW, wallHeight, -halfD],
      [halfW, ridgeY, 0],
      [-halfW, ridgeY, 0],
    ],
    yieldKwhPerSqm: 620,
  };

  // Naive grid placement on the south face — 1.7 m × 1.0 m panels, 0.3 m edge
  // offset, no obstructions. Project (u, v) on the slope back to world coords.
  const PANEL_W = 1.7;
  const PANEL_H = 1.0;
  const EDGE = 0.3;
  const startU = -halfW + EDGE + PANEL_W / 2;
  const endU = halfW - EDGE - PANEL_W / 2;
  const slopeLen = Math.hypot(halfD, ridgeY - wallHeight);
  const startV = EDGE + PANEL_H / 2;
  const endV = slopeLen - EDGE - PANEL_H / 2;
  const modulePositions: { x: number; y: number; z: number; faceId: number }[] = [];
  for (let v = startV; v <= endV + 1e-6; v += PANEL_H + 0.05) {
    // Interpolate from eave (wallHeight, z=halfD) to ridge (ridgeY, z=0)
    const t = v / slopeLen;
    const y = wallHeight + (ridgeY - wallHeight) * t;
    const z = halfD * (1 - t);
    for (let u = startU; u <= endU + 1e-6; u += PANEL_W + 0.05) {
      modulePositions.push({ x: u, y, z, faceId: 0 });
    }
  }

  return {
    houseId: 'brandenburg', // synthetic geometry — houseId is irrelevant downstream
    faces: [southFace, northFace],
    obstructions: [],
    modulePositions,
    buildingFootprint: {
      center: [0, 0, 0],
      size: [width, wallHeight, depth],
    },
  };
}

/**
 * Heuristic profile inference for unknown addresses. The k-NN engine will
 * still cluster against Reonic's 1620 deliveries — this only seeds the form.
 * Tuned on German residential medians (Destatis 2024).
 */
export function inferProfileFromLocation(
  _lat: number | undefined,
  _lng: number | undefined,
): CustomerProfile {
  return {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: false,
    heatingType: 'gas',
    houseSizeSqm: 140,
    isJumelee: false,
  };
}
