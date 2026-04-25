// Offline solar yield baking — OWNED by Dev D
// Run: pnpm tsx src/scripts/bake-yield.ts
//
// For each triangle of each roof face, compute annual kWh/m² accounting for:
// - Sun position 8760h (suncalc, lat 52° DE average)
// - Self-shadows from the roof geometry (raycasting)
// - Direct + diffuse irradiance (~1100 kWh/m²/yr DE baseline)
// Output: vertex colors RGB array (turbo gradient) → applied at runtime in Heatmap.tsx

import { promises as fs } from 'node:fs';
import path from 'node:path';
// import SunCalc from 'suncalc';

async function main() {
  // TODO Dev D:
  // 1. Read public/baked/{house}-roof.json
  // 2. For each face, for each triangle:
  //    For each hour h in [0..8760]:
  //      - Compute sun position (azimuth, altitude) for hour h at lat 52°
  //      - If sun below horizon: skip
  //      - Compute angle of incidence with triangle normal
  //      - Cast ray from triangle centroid to sun: if blocked → skip direct
  //      - Add direct (cos(incidence) × DNI) + diffuse (constant)
  //    Sum to get annual kWh/m²
  // 3. Map to turbo gradient RGB
  // 4. Output public/baked/{house}-yield.json with per-vertex colors

  console.log('TODO Dev D');
}

main().catch(console.error);
