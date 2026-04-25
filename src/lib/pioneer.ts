// Pioneer (Fastino) integration — OWNED by Dev B
// Primary BOM predictor: model fine-tuned on 1620 Reonic projects.
// Falls back to k-NN if PIONEER_DISABLED=true.

import type { CustomerProfile, DesignResult } from './types';
import { recommendSystem } from './sizing';

const PIONEER_API_URL = process.env.PIONEER_API_URL ?? '';
const PIONEER_API_KEY = process.env.PIONEER_API_KEY ?? '';
const PIONEER_DISABLED = process.env.PIONEER_DISABLED === 'true';

export async function predictBomViaPioneer(
  profile: CustomerProfile,
  roofMaxKwp: number,
): Promise<Pick<DesignResult, 'totalKwp' | 'batteryCapacityKwh' | 'heatPumpNominalPowerKw' | 'source' | 'inferenceMs'>> {
  if (PIONEER_DISABLED || !PIONEER_API_URL) {
    const start = performance.now();
    const knn = await recommendSystem(profile, roofMaxKwp);
    return {
      totalKwp: knn.totalKwp,
      batteryCapacityKwh: knn.batteryCapacityKwh,
      heatPumpNominalPowerKw: knn.heatPumpNominalPowerKw,
      source: 'knn-fallback',
      inferenceMs: performance.now() - start,
    };
  }

  // TODO Dev B: call Pioneer endpoint with normalized features
  // POST PIONEER_API_URL { features: { ... } }
  // Parse output, return shaped result

  throw new Error('Pioneer client not implemented — Dev B');
}
