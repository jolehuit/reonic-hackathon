// Offline roof analysis — OWNED by Dev D
// Run: pnpm tsx src/scripts/analyze-roof.ts
//
// Input  : public/baked/{house}-photogrammetry.glb (output of fetch-3d-tiles.ts)
// Output : public/baked/{house}-analysis.json
//          {
//            houseId, faces[] (id, normal, area, azimuth, tilt, vertices, yieldKwhPerSqm),
//            obstructions[] (id, type, position, radius),
//            modulePositions[] (x, y, z, faceId) — placed by place-panels.ts,
//            buildingFootprint (bbox in mesh-local coords, used by generate-stylized.ts)
//          }
//
// CRITICAL: this is the project's #1 risk. Checkpoint Sat 17:00 (kickoff Sat 15:00).
// If DBSCAN doesn't yield usable plans on the photogrammetric mesh → fallback :
//   - Open photogrammetry.glb in Blender, manually pick the roof faces, export as JSON
//   - Or estimate space (per the brief: "If too hard, build something that estimates the space available")

import { promises as fs } from 'node:fs';
import path from 'node:path';
// import { DBSCAN } from 'density-clustering';
// import { NodeIO } from '@gltf-transform/core';

const HOUSES = ['brandenburg', 'hamburg', 'ruhr'] as const;

async function main() {
  for (const house of HOUSES) {
    console.log(`Analyzing ${house}...`);

    // TODO Dev D:
    // 1. Load public/baked/{house}-photogrammetry.glb via @gltf-transform/core
    // 2. Extract triangles + normals + positions (BufferGeometry)
    // 3. DBSCAN on normals (eps=0.1, minPoints=10) → roof face clusters
    // 4. For each cluster: mean normal → azimuth + tilt; convex hull → vertices; area
    // 5. Detect obstructions (small isolated clusters within a roof face)
    // 6. Compute yield per face (suncalc + raycaster shadow OR uniform 1100 kWh/m²/yr DE baseline)
    // 7. Compute building footprint (bbox of all geometry except ground plane)
    // 8. Place panels via place-panels.ts::placePanelsOnFace for each face
    // 9. Write public/baked/{house}-analysis.json

    const output = {
      houseId: house,
      faces: [],
      obstructions: [],
      modulePositions: [],
      buildingFootprint: {
        center: [0, 0, 0],
        size: [0, 0, 0],
      },
    };

    const outPath = path.join(process.cwd(), 'public/baked', `${house}-analysis.json`);
    await fs.writeFile(outPath, JSON.stringify(output, null, 2));
    console.log(`  → ${outPath}`);
  }
}

main().catch(console.error);
