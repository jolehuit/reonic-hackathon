// Generate stylized low-poly model — OWNED by Dev D
// Run: pnpm tsx src/scripts/generate-stylized.ts
//
// Input  : public/baked/{house}-analysis.json (footprint + roof faces from analyze-roof.ts)
// Output : public/baked/{house}-stylized.glb (low-poly volume + roof faces, no textures)
//
// Goal: produce a clean architectural-mockup-style mesh that matches the building's
// real proportions (extracted from the photogrammetric analysis) but stripped of
// noise, vegetation, neighbors, and texture artifacts.
//
// Style target: white/cream toon-shaded volume, hard edges, ready for outline shader
// at runtime. Think Norman Foster renderings or low-poly architectural mockups.
//
// The panel positions in analysis.modulePositions are ALREADY in this same coordinate
// frame (since this mesh is built FROM the analysis), so Dev A can place panels
// straight from analysis.json without remapping.

import { promises as fs } from 'node:fs';
import path from 'node:path';
// import { Document, NodeIO } from '@gltf-transform/core';

const HOUSES = ['brandenburg', 'hamburg', 'ruhr'] as const;

async function main() {
  for (const house of HOUSES) {
    console.log(`Stylizing ${house}...`);

    // TODO Dev D:
    // 1. Read public/baked/{house}-analysis.json
    // 2. Build a glTF Document with @gltf-transform/core
    // 3. Generate the building volume:
    //    a. Floor footprint = analysis.buildingFootprint as a flat rectangle
    //    b. Walls = extruded box up to the roof's lowest edge (eaves height)
    //    c. Roof = each detected face from analysis.faces, simplified to a quad polygon
    //       — Use the face's vertices directly if cleanly extracted
    //       — Else use azimuth + tilt + area to reconstruct a regular shape
    // 4. Add chimney + dormer obstructions as small extrusions
    // 5. Use a single white/cream material (no textures)
    // 6. Set vertex normals (flat shading)
    // 7. Export as GLB → public/baked/{house}-stylized.glb
    //
    // The render-side outline shader (Dev A) will draw black edges on this mesh.

    const outPath = path.join(process.cwd(), 'public/baked', `${house}-stylized.glb`);
    console.log(`  → ${outPath} (TODO Dev D)`);
    void outPath;
  }
}

main().catch(console.error);

// Placeholder export so TS doesn't complain
export {};
