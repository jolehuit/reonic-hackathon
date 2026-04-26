// Fetch Google 3D Tiles for the demo addresses — OWNED by Dev D
// Run: pnpm bake:fetch
//
// Goal: download the photogrammetric mesh around each demo address and save
// it as a local GLB. The raw mesh is used OFFLINE only for roof analysis;
// it is NEVER rendered in the user-facing demo.
//
// Strategy:
// 1. TilesRenderer + GoogleCloudAuthPlugin pointed at a virtual camera over (lat, lng).
// 2. Pump tiles.update() in a loop until queues are empty (downloading + parsing).
// 3. Walk tiles.group, collect all THREE.Mesh, crop to a ~80×80 m bbox around the
//    target ECEF position, merge into a single Group.
// 4. Export with GLTFExporter (binary GLB) and write to public/baked/{house}-photogrammetry.glb.
//
// IMPORTANT: 3d-tiles-renderer is browser-first. We bridge to Node by polyfilling
// the bare minimum DOM (fetch, ImageBitmap-via-sharp). If that proves too painful
// in the 2h hard timebox → Plan B: serve a small Vite page that downloads the GLB
// in the browser and `URL.createObjectURL` → manual save.

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Minimal browser-globals polyfill — 3d-tiles-renderer + GLTFExporter assume DOM.
// Must run BEFORE three / 3d-tiles-renderer imports resolve.
const g = globalThis as unknown as Record<string, unknown>;

// Patch URL.createObjectURL FIRST — GLTFLoader captures it on the global URL
// at module load time, so it must exist before three's GLTFLoader is imported.
const URLCtor = g.URL as unknown as { createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void };
if (URLCtor && !URLCtor.createObjectURL) {
  URLCtor.createObjectURL = () => 'data:application/octet-stream;base64,';
  URLCtor.revokeObjectURL = () => undefined;
}

// `window` / `self` must alias globalThis so things like `self.URL.createObjectURL`,
// `self.fetch`, etc. resolve to the Node globals rather than empty stubs.
if (!g.location) g.location = { href: 'https://localhost/', origin: 'https://localhost' };
if (!g.window) g.window = globalThis;
if (!g.self) g.self = globalThis;
if (!g.document) {
  g.document = {
    createElementNS: () => ({ style: {} }),
    createElement: () => ({ style: {} }),
  };
}
// 3d-tiles-renderer's Scheduler uses rAF for off-main-thread work pacing.
// In Node, fall back to setImmediate (ticks asap, no 16ms gating).
// Guard cancelAnimationFrame against sentinel values (-1, 0, null) the lib
// stores when nothing is scheduled — clearImmediate would otherwise throw
// "Cannot create property '_destroyed' on number '-1'".
if (!g.requestAnimationFrame) {
  g.requestAnimationFrame = (cb: (t: number) => void) =>
    setImmediate(() => cb(performance.now())) as unknown as number;
  g.cancelAnimationFrame = (id: unknown) => {
    if (id && typeof id === 'object') {
      try {
        clearImmediate(id as NodeJS.Immediate);
      } catch {
        /* not a real Immediate handle — ignore */
      }
    }
  };
}
// GLTFExporter uses FileReader to convert images to data URIs. Stub it —
// our exported GLB only carries geometry, no embedded images.
if (!g.FileReader) {
  class FileReaderStub {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() { this.result = 'data:application/octet-stream;base64,'; this.onload?.(); }
    readAsArrayBuffer() { this.result = ''; this.onload?.(); }
  }
  g.FileReader = FileReaderStub;
}
// Image loading: GLTFLoader uses ImageLoader → new Image(). Skip texture loads
// entirely by returning a stub object that immediately fires onload.
if (!g.Image) {
  class ImageStub {
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 1;
    height = 1;
    addEventListener(ev: string, cb: () => void) { if (ev === 'load') setImmediate(cb); }
    removeEventListener() {}
  }
  g.Image = ImageStub;
}
// createImageBitmap: same idea — return a tiny stub.
if (!g.createImageBitmap) {
  g.createImageBitmap = async () => ({ width: 1, height: 1, close: () => undefined });
}
// ImageBitmap class is referenced by 3d-tiles-renderer when disposing tiles
// (instanceof checks). A dummy class is enough to satisfy the check.
if (!g.ImageBitmap) {
  class ImageBitmapStub { close() {} }
  g.ImageBitmap = ImageBitmapStub;
}

import * as THREE from 'three';

interface DemoHouse {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

const HOUSES: DemoHouse[] = [
  // The three demo houses surfaced in the UI. Coords MUST match the
  // addresses shown in src/lib/houses.ts::HOUSE_LOCATION — otherwise the
  // sidebar lies about which building the analysis was run on. Earlier
  // placeholder coords (Hamburg=53.55,9.99, Ruhr=Dortmund city centre)
  // captured multiple buildings and produced absurd panel counts (1053+).
  { id: 'brandenburg', lat: 52.4530, lng: 13.2868, label: 'Thielallee 36, Berlin' },
  { id: 'hamburg', lat: 52.408257, lng: 12.964409, label: 'Test address 2 Potsdam-Golm 14476, DE' },
  { id: 'ruhr', lat: 52.616457, lng: 13.485022, label: 'Schönerlinder Weg 83, Berlin Karow' },
  // Independent test houseIds so subagents can run in parallel without file
  // collisions (each houseId namespaces its own photogrammetry / analysis files).
  { id: 'test1', lat: 52.4083205, lng: 12.9658936, label: 'Ritterstraße 33, Golm, Potsdam 14476, DE' },
  { id: 'test2', lat: 52.408257, lng: 12.964409, label: 'Test address 2 Potsdam-Golm 14476, DE' },
  { id: 'test3', lat: 52.408718770055735, lng: 12.963106383979836, label: 'Test address 3 Potsdam-Golm (multi-level)' },
  { id: 'test4', lat: 52.411893, lng: 12.983772, label: 'Test address 4 Potsdam (Reihenhaus)' },
  // Bench batch 2 — 10 detached houses across DE for benchmark validation.
  { id: 'bench-koeln1', lat: 50.959561, lng: 6.922748, label: 'Eisheiligenstraße 30, Köln' },
  { id: 'bench-koeln2', lat: 50.937618, lng: 6.926385, label: 'Aachener Straße 134, Köln' },
  { id: 'bench-berlin2', lat: 52.515858, lng: 13.343253, label: 'Händelallee 43, Berlin Tiergarten' },
  { id: 'bench-meerbusch', lat: 51.255416, lng: 6.713103, label: 'Niederlöricker Straße 48, Meerbusch' },
  { id: 'bench-leipzig', lat: 51.310576, lng: 12.325513, label: 'Dieskaustraße 100, Leipzig' },
  { id: 'bench-hamburg2', lat: 53.6223, lng: 9.9531, label: 'Tibarg 52, Hamburg' },
  { id: 'bench-dresden1', lat: 51.044925, lng: 13.690627, label: 'Malterstraße 13, Dresden' },
  { id: 'bench-dresden2', lat: 51.034203, lng: 13.748380, label: 'Strehlener Straße 77, Dresden' },
  { id: 'bench-berlin1', lat: 52.4530, lng: 13.2868, label: 'Thielallee 36, Berlin' },
  { id: 'bench-bochum', lat: 51.5067, lng: 7.1810, label: 'An den Klärbrunnen 4, Bochum' },
  { id: 'bench-uckermark', lat: 53.30722475071542, lng: 13.545693641054664, label: 'Seegut Blaue Blume, Boitzenburger Land (Uckermark, Brandenburg)' },
  // Bench batch 3 — 10 detached houses around Berlin metro
  { id: 'b3-zehlendorf', lat: 52.438195, lng: 13.282944, label: 'Curtiusstraße 81, Berlin Zehlendorf' },
  { id: 'b3-wannsee', lat: 52.416139, lng: 13.142791, label: 'Sommerfieldring 59, Berlin Wannsee' },
  { id: 'b3-kladow', lat: 52.456313, lng: 13.105187, label: 'Nibelungenstraße 1, Berlin Kladow' },
  { id: 'b3-mahlsdorf', lat: 52.499827, lng: 13.620289, label: 'Pilgramer Straße 303, Berlin Mahlsdorf' },
  { id: 'b3-karow', lat: 52.616457, lng: 13.485022, label: 'Schönerlinder Weg 83, Berlin Karow' },
  { id: 'b3-lichterfelde', lat: 52.424113, lng: 13.291262, label: 'Aarauer Straße 40, Berlin Lichterfelde' },
  { id: 'b3-hermsdorf', lat: 52.625560, lng: 13.295742, label: 'Kurhausstraße 26, Berlin Hermsdorf' },
  { id: 'b3-mahlsdorf2', lat: 52.510851, lng: 13.591678, label: 'Myslowitzer Straße 4, Berlin Mahlsdorf' },
  { id: 'b3-hermsdorf2', lat: 52.634257, lng: 13.294468, label: 'Edelhofdamm 15, Berlin Hermsdorf' },
  { id: 'b3-wannsee2', lat: 52.415549, lng: 13.145374, label: 'Chausseestraße 12A, Berlin Wannsee' },
];

// ~120 m radius around target — wide enough to overlap multiple Google tiles
// (which can be 50-100 m each), narrow enough to keep the GLB small.
const CROP_HALF_EXTENT_M = 120;
// Camera altitude over target — high enough to load LOD ~18 tiles in one shot.
const CAMERA_ALTITUDE_M = 250;
// Hard ceiling for the update loop (avoid infinite-pull on a flaky network).
const MAX_UPDATE_ITERATIONS = 600;

const OUTPUT_DIR = path.join(process.cwd(), 'public/baked');
const TILES_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';

async function loadTilesRenderer() {
  // Lazy import — keeps the file parseable even when deps haven't been installed yet.
  const renderer = await import('3d-tiles-renderer');
  const plugins = await import('3d-tiles-renderer/plugins');
  return { TilesRenderer: renderer.TilesRenderer, GoogleCloudAuthPlugin: plugins.GoogleCloudAuthPlugin };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 1, 1_000_000);
  // Position is set once tiles + ellipsoid are ready (see fetchHouse).
  return cam;
}

async function fetchHouse(
  house: DemoHouse,
  apiKey: string,
): Promise<void> {
  const { TilesRenderer, GoogleCloudAuthPlugin } = await loadTilesRenderer();

  console.log(`[${house.id}] init TilesRenderer`);
  const tiles = new TilesRenderer(TILES_ROOT);
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));

  const camera = makeCamera();
  // Headless: skip WebGLRenderer (needs DOM) and feed resolution directly.
  tiles.setCamera(camera);
  tiles.setResolution(camera, 1024, 1024);

  // Wait for the root tileset to load (so tiles.ellipsoid is populated).
  // We pump update() concurrently — the root only fetches once update() runs.
  console.log(`[${house.id}] waiting for root tileset…`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('root tileset load timeout')), 30_000);
    const onLoad = () => {
      clearTimeout(timeout);
      tiles.removeEventListener('load-tileset', onLoad);
      resolve();
    };
    tiles.addEventListener('load-tileset', onLoad);
    tiles.update();
  });

  const latRad = THREE.MathUtils.degToRad(house.lat);
  const lngRad = THREE.MathUtils.degToRad(house.lng);
  // `target` = ground point at the address (altitude 0). Used as the bbox center.
  const target = new THREE.Vector3();
  tiles.ellipsoid.getCartographicToPosition(latRad, lngRad, 0, target);
  // `cameraPos` = same lat/lng but raised CAMERA_ALTITUDE_M, looking back down at target.
  const cameraPos = new THREE.Vector3();
  tiles.ellipsoid.getCartographicToPosition(latRad, lngRad, CAMERA_ALTITUDE_M, cameraPos);

  camera.position.copy(cameraPos);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);

  // Pump the tile loader until queues drain. `stats` is exposed at runtime
  // by TilesRendererBase (downloading + parsing counters) but isn't in the d.ts.
  // Wait for at least ONE tile to start downloading before allowing exit on idle —
  // the first few update() calls may return idle while the request queue is filling.
  console.log(`[${house.id}] downloading tiles…`);
  let everActive = false;
  let idleStreak = 0;
  for (let i = 0; i < MAX_UPDATE_ITERATIONS; i++) {
    tiles.update();
    const stats = (tiles as unknown as { stats?: { downloading: number; parsing: number } }).stats;
    const downloading = stats?.downloading ?? 0;
    const parsing = stats?.parsing ?? 0;
    if (downloading > 0 || parsing > 0) {
      everActive = true;
      idleStreak = 0;
    } else {
      idleStreak++;
    }
    if (i % 20 === 0) console.log(`[${house.id}]   iter ${i} dl=${downloading} parse=${parsing}`);
    // Exit only once we have seen activity AND the queues stay idle for ~1 s.
    if (everActive && idleStreak > 20) break;
    // Safety net: 6 s of cold idle at start → likely a quota/auth issue.
    if (!everActive && i > 120) {
      throw new Error('no tiles requested after 6 s — check API key / activate "Map Tiles API" in Google Cloud Console');
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // Crop to local bbox around target (~80×80 m).
  const cropMin = target.clone().addScalar(-CROP_HALF_EXTENT_M);
  const cropMax = target.clone().addScalar(+CROP_HALF_EXTENT_M);
  const bbox = new THREE.Box3(cropMin, cropMax);

  // Debug: total bounds of all loaded meshes vs. target.
  const allBounds = new THREE.Box3();
  let totalMeshes = 0;
  tiles.group.updateMatrixWorld(true);
  tiles.group.traverse((obj: THREE.Object3D) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
      if (b) allBounds.union(b);
      totalMeshes++;
    }
  });
  console.log(`[${house.id}] loaded ${totalMeshes} meshes total; world bounds:`);
  console.log(`  min: ${allBounds.min.toArray().map((n) => n.toFixed(1))}`);
  console.log(`  max: ${allBounds.max.toArray().map((n) => n.toFixed(1))}`);
  console.log(`  target: ${target.toArray().map((n) => n.toFixed(1))}`);
  console.log(`  target inside mesh bounds? ${allBounds.containsPoint(target)}`);

  const exportRoot = new THREE.Group();
  exportRoot.name = `${house.id}-photogrammetry`;
  // Strip all materials/textures — analysis only needs geometry, and GLTFExporter
  // crashes on textured materials in headless Node (no canvas.getContext).
  const plainMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  let meshCount = 0;
  tiles.group.traverse((obj: THREE.Object3D) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const meshBox = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
      if (!meshBox) return;
      // Keep mesh if its AABB overlaps the crop OR its center is within radius.
      const distToTarget = meshBox.getCenter(new THREE.Vector3()).distanceTo(target);
      if (meshBox.intersectsBox(bbox) || distToTarget < CROP_HALF_EXTENT_M) {
        const cloned = mesh.clone();
        cloned.material = plainMaterial;
        exportRoot.add(cloned);
        meshCount++;
      }
    }
  });
  console.log(`[${house.id}] cropped to ${meshCount} meshes inside ${CROP_HALF_EXTENT_M * 2}×${CROP_HALF_EXTENT_M * 2} m bbox`);
  if (meshCount === 0) {
    throw new Error('no tile meshes intersected the crop bbox — camera may be too far / wrong frame');
  }

  // Reorient + recenter into a local frame: ENU has Z=up but three.js / our
  // analyser uses Y=up. So we go ECEF → ENU → swap so Y=up, X=East, Z=South
  // (right-handed Y-up). All downstream code can then assume Y is vertical.
  const enu = new THREE.Matrix4();
  tiles.ellipsoid.getEastNorthUpFrame(latRad, lngRad, 0, enu);
  const ecefToEnu = enu.clone().invert();
  // ENU (E, N, U) → Y-up (E, U, -N): rotate -90° around X.
  const enuToYup = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const ecefToLocal = new THREE.Matrix4().multiplyMatrices(enuToYup, ecefToEnu);

  // Skip GLTFExporter (hangs on textures/materials in headless Node).
  // Write a compact JSON: { positions: Float32Array, normals?: Float32Array, indices?: Uint32Array }
  // analyze-roof.ts reads this directly via readPhotogrammetry().
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const obj of exportRoot.children) {
    if (!(obj as THREE.Mesh).isMesh) continue;
    const mesh = obj as THREE.Mesh;
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr) continue;
    const idxAttr = geom.getIndex();

    const tmpV = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(ecefToLocal);
      positions.push(tmpV.x, tmpV.y, tmpV.z);
    }

    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) indices.push(idxAttr.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += posAttr.count;
  }

  const outPath = path.join(OUTPUT_DIR, `${house.id}-photogrammetry.json`);
  const payload = {
    houseId: house.id,
    lat: house.lat,
    lng: house.lng,
    frame: 'enu-local-meters',
    positionCount: positions.length / 3,
    triangleCount: indices.length / 3,
    positions,
    indices,
  };
  await fs.writeFile(outPath, JSON.stringify(payload));
  const sizeKB = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0);
  console.log(`[${house.id}] wrote ${outPath} (${sizeKB} KB, ${payload.triangleCount} triangles)`);

  tiles.dispose();
}

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('Missing GOOGLE_MAPS_API_KEY. Set it in .env.local first.');
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Optional CLI filter: `pnpm bake:fetch brandenburg` → fetch only that house.
  // Or live mode (used by /api/design when GPS coords miss the cache):
  //   LIVE_HOUSE_ID=live-xyz LIVE_LAT=52.45 LIVE_LNG=13.28 pnpm bake:fetch
  const onlyId = process.argv[2];
  const liveId = process.env.LIVE_HOUSE_ID;
  const liveLat = process.env.LIVE_LAT ? parseFloat(process.env.LIVE_LAT) : null;
  const liveLng = process.env.LIVE_LNG ? parseFloat(process.env.LIVE_LNG) : null;
  let queue: DemoHouse[];
  if (liveId && liveLat !== null && liveLng !== null) {
    queue = [{ id: liveId, lat: liveLat, lng: liveLng, label: `Live: ${liveId}` }];
  } else {
    queue = onlyId ? HOUSES.filter((h) => h.id === onlyId) : HOUSES;
    if (onlyId && queue.length === 0) {
      console.error(`Unknown house "${onlyId}". Known: ${HOUSES.map((h) => h.id).join(', ')}`);
      process.exit(1);
    }
  }

  for (const house of queue) {
    try {
      await fetchHouse(house, apiKey);
    } catch (err) {
      console.error(`[${house.id}] failed:`, err);
      console.error(`[${house.id}] PLAN B → open public/models/${house.id}.glb in Blender and hardcode analysis.json by hand.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
