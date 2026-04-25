// Offline roof segmentation — OWNED by Dev D
// Run: pnpm tsx src/scripts/bake-roofs.ts
//
// CRITICAL: This is the project's #1 risk.
// CHECKPOINT Sat 13:00 — if DBSCAN doesn't yield usable plans → switch to manual fallback.

import { promises as fs } from 'node:fs';
import path from 'node:path';
// import { DBSCAN } from 'density-clustering';
// import { NodeIO } from '@gltf-transform/core';

const HOUSES = ['brandenburg', 'hamburg', 'north-germany', 'ruhr'] as const;

async function main() {
  for (const house of HOUSES) {
    console.log(`Processing ${house}...`);

    // TODO Dev D:
    // 1. Load GLB via @gltf-transform/core
    // 2. Extract mesh primitives (triangles + normals)
    // 3. Compute per-triangle normal vector
    // 4. DBSCAN on normals (eps=0.1, minPoints=10)
    // 5. For each cluster:
    //    - Compute mean normal → orientation (azimuth) + tilt
    //    - Compute polygon vertices (convex hull of triangle vertices in local 2D)
    //    - Compute area
    // 6. Detect obstructions: small clusters or outliers within a roof face
    // 7. Output JSON to public/baked/{house}-roof.json

    const output = {
      houseId: house,
      faces: [], // RoofFace[]
      obstructions: [], // Obstruction[]
    };

    const outPath = path.join(process.cwd(), 'public/baked', `${house}-roof.json`);
    await fs.writeFile(outPath, JSON.stringify(output, null, 2));
    console.log(`  → ${outPath}`);
  }
}

main().catch(console.error);
