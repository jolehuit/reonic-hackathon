// Dev-only mocks — OWNED by Dev A
// Activated via ?mock=1 query param while NODE_ENV === 'development'.
// Lets Dev A test the full 3D rendering pipeline before Dev B/C/D push their work.
// Strictly scoped to Scene3D/, never imported by other devs' code.

import type { CustomerProfile, DesignResult, HouseId, SimilarProject } from '@/lib/types';

export const MOCK_PROFILES: Record<HouseId, CustomerProfile> = {
  brandenburg: {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: true,
    evAnnualKm: 15000,
    heatingType: 'gas',
    houseSizeSqm: 140,
    isJumelee: false,
  },
  hamburg: {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
    isJumelee: false,
  },
  ruhr: {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
    isJumelee: false,
  },
};

const MOCK_SIMILAR: SimilarProject[] = [
  { projectId: 'R-1042', energyDemandKwh: 4400, hasEv: true, totalKwp: 9.0, batteryKwh: 6, priceEur: 11200 },
  { projectId: 'R-1781', energyDemandKwh: 4700, hasEv: true, totalKwp: 9.5, batteryKwh: 7, priceEur: 11800 },
  { projectId: 'R-0934', energyDemandKwh: 4300, hasEv: false, totalKwp: 8.6, batteryKwh: 5, priceEur: 10600 },
];

// Module positions on the SSW roof face. Y is interpolated on the 35° slope
// (face 0 goes from y=3 at z=2.5 to y=4.2 at z=0). Two clean rows of 4
// modules, each with the panel center 0.4 m away from the eave / ridge so
// the rotated 1 m deep panels stay fully within the slope.
const MOCK_MODULE_POSITIONS = [
  { x: -2.8, y: 3.384, z: 1.7, faceId: 0 },
  { x: -1.0, y: 3.384, z: 1.7, faceId: 0 },
  { x: 1.0, y: 3.384, z: 1.7, faceId: 0 },
  { x: 2.8, y: 3.384, z: 1.7, faceId: 0 },
  { x: -2.8, y: 3.864, z: 0.7, faceId: 0 },
  { x: -1.0, y: 3.864, z: 0.7, faceId: 0 },
  { x: 1.0, y: 3.864, z: 0.7, faceId: 0 },
  { x: 2.8, y: 3.864, z: 0.7, faceId: 0 },
];

export const MOCK_DESIGN: DesignResult = {
  moduleCount: MOCK_MODULE_POSITIONS.length,
  moduleBrand: 'AIKO',
  moduleWattPeak: 440,
  totalKwp: (MOCK_MODULE_POSITIONS.length * 440) / 1000,
  modulePositions: MOCK_MODULE_POSITIONS,

  inverterModel: 'Sungrow SH10.0RT',
  inverterPowerKw: 10,
  inverterLoadPercent: 78,

  batteryCapacityKwh: 6,
  batteryBrand: 'BYD HVS',

  heatPumpModel: 'Vaillant aroTHERM Plus',
  heatPumpNominalPowerKw: 8,

  wallboxChargeSpeedKw: 11,

  totalPriceEur: 11400,
  paybackYears: 9.4,
  co2SavedTonsPer25y: 8.2,

  similarProjects: MOCK_SIMILAR,
  deltaVsMedian: {
    kwp: 0.4,
    batteryKwh: 0,
    priceEur: 200,
  },

  source: 'knn',
  inferenceMs: 12,
};
