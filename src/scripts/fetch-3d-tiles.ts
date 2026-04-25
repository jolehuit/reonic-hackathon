// Fetch Google 3D Tiles for the demo addresses — OWNED by Dev D
// Run: pnpm tsx src/scripts/fetch-3d-tiles.ts
//
// Goal: download the photogrammetric mesh around each demo address and save
// it as a local GLB. The raw mesh is used OFFLINE only for roof analysis;
// it is NEVER rendered in the user-facing demo.
//
// Strategy:
// 1. Use 3d-tiles-renderer headless (Node) with GoogleCloudAuthPlugin
// 2. Set camera over the target lat/lng, force tile load at high LOD
// 3. Walk the loaded tile group, collect meshes, merge, export as GLB
// 4. Save to public/baked/{house}-photogrammetry.glb
//
// Useful refs:
// - https://github.com/NASA-AMMOS/3DTilesRendererJS
// - https://developers.google.com/maps/documentation/tile/3d-tiles
// - https://github.com/donmccurdy/glb-transform (export helpers)

import { promises as fs } from 'node:fs';
import path from 'node:path';

interface DemoHouse {
  id: 'brandenburg' | 'hamburg' | 'ruhr';
  lat: number;
  lng: number;
  label: string;
}

const HOUSES: DemoHouse[] = [
  { id: 'brandenburg', lat: 52.4125, lng: 13.06, label: 'Brandenburg an der Havel, DE' },
  { id: 'hamburg', lat: 53.55, lng: 9.99, label: 'Hamburg, DE' },
  { id: 'ruhr', lat: 51.5135, lng: 7.4653, label: 'Dortmund (Ruhr), DE' },
];

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('Missing GOOGLE_MAPS_API_KEY. Set it in .env.local first.');
    process.exit(1);
  }

  for (const h of HOUSES) {
    console.log(`Fetching 3D Tiles for ${h.id} (${h.label})...`);

    // TODO Dev D:
    // 1. import { TilesRenderer } from '3d-tiles-renderer'
    // 2. import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins'
    // 3. Instantiate TilesRenderer('https://tile.googleapis.com/v1/3dtiles/root.json')
    // 4. Set up a virtual PerspectiveCamera positioned over (h.lat, h.lng) at ~150m altitude looking down
    // 5. registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey }))
    // 6. tiles.update() in a loop until tilesRenderer.stats.downloadingTiles == 0 (and parsing == 0)
    // 7. Walk tiles.group, extract all Meshes, GLTFExporter.parse() to GLB binary
    // 8. fs.writeFile(public/baked/{h.id}-photogrammetry.glb)
    //
    // Critical: this runs in Node, so you'll need a JSDOM/headless GL substitute
    // OR run as a one-off in a small Vite page that does the download client-side
    // and trigger a download — sometimes simpler in 2-3h.

    const outPath = path.join(process.cwd(), 'public/baked', `${h.id}-photogrammetry.glb`);
    console.log(`  → ${outPath} (TODO Dev D)`);
    void outPath;
  }
}

main().catch(console.error);
