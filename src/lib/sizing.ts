// k-NN sizing engine — OWNED by Dev B
// In-memory over the 1620 projects from Reonic dataset.
// Used as primary OR as fallback if Pioneer fails.

import type { CustomerProfile, DesignResult, SimilarProject } from './types';

// TODO Dev B: load CSVs at boot, normalize, expose query function
// const projects: ProjectRow[] = await loadProjects();

export interface ProjectRow {
  projectId: string;
  energyDemandKwh: number;
  hasEv: boolean;
  evAnnualKm: number;
  inhabitants: number;
  heatingType: string;
  houseSizeSqm: number;
  // BOM aggregated
  totalKwp: number;
  batteryKwh: number;
  hasHeatPump: boolean;
  priceEur: number;
}

export async function recommendSystem(
  profile: CustomerProfile,
  roofMaxKwp: number,
): Promise<Pick<DesignResult, 'totalKwp' | 'batteryCapacityKwh' | 'heatPumpNominalPowerKw' | 'similarProjects' | 'deltaVsMedian' | 'source' | 'inferenceMs'>> {
  // TODO Dev B: implement k-NN
  // 1. normalize features (z-score)
  // 2. find k=5 nearest neighbors
  // 3. aggregate (median) for kWp, kWh, HP
  // 4. cap kWp at roofMaxKwp
  // 5. return DesignResult fields + similarProjects

  throw new Error('Not implemented — Dev B');
}

export function findSimilarProjects(
  profile: CustomerProfile,
  k: number = 3,
): SimilarProject[] {
  // TODO Dev B
  return [];
}
