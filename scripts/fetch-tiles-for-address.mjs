#!/usr/bin/env node
// Crawl the Google Photorealistic 3D Tiles tree and download ONLY the tiles
// that contain a given address (lat/lng → ECEF → containsPoint check on each
// tile's boundingVolume). No rendering, just the raw GLB content.
//
// Pipeline:
//   1. Geocode address.
//   2. Convert lat/lng → ECEF (geocentric).
//   3. Fetch root.json (preserves Google's `session` param across hops).
//   4. Recursively descend: for each tile whose boundingVolume contains the
//      ECEF point, collect content.uri; if content is a sub-tileset (.json),
//      fetch and recurse into it.
//   5. Download the matching GLB files to public/tiles/<address-slug>/.
//   6. Write manifest.json with the full provenance (depth, geometric error,
//      bounding volume type, source URL).
//
// Run:
//   node scripts/fetch-tiles-for-address.mjs "61 Bd Jean Moulin, 93190 Livry-Gargan, France"
//
// Caveats: Google's ToS forbid redistributing the tiles. Use locally for
// dev/preview only.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const TILES_BASE = 'https://tile.googleapis.com/v1/3dtiles';
const ROOT_URL = `${TILES_BASE}/root.json`;
const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';

// ─── env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  const content = readFileSync(join(PROJECT_ROOT, '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// ─── 1. geocode ───────────────────────────────────────────────────────────
async function geocode(address, key) {
  const res = await fetch(`${GEOCODE_BASE}?address=${encodeURIComponent(address)}&key=${key}`);
  if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Geocode failed: ${data.status} ${data.error_message ?? ''}`);
  }
  return {
    lat: data.results[0].geometry.location.lat,
    lng: data.results[0].geometry.location.lng,
    formatted: data.results[0].formatted_address,
  };
}

// ─── 2. lat/lon → ECEF (WGS84) ────────────────────────────────────────────
function lonLatToECEF(lon, lat, height = 0) {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const radLat = (lat * Math.PI) / 180;
  const radLon = (lon * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(radLat) ** 2);
  return [
    (N + height) * Math.cos(radLat) * Math.cos(radLon),
    (N + height) * Math.cos(radLat) * Math.sin(radLon),
    (N * (1 - e2) + height) * Math.sin(radLat),
  ];
}

function ecefToLonLat([x, y, z]) {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const lon = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);
  // Bowring's iterative — stable for surface points.
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - (e2 * N) / (N + h)));
  }
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const h = p / Math.cos(lat) - N;
  return { lat, lon, height: h };
}

// ─── 4. boundingVolume contains point ─────────────────────────────────────
function containsPoint(bv, point) {
  if (bv.box) return containsBox(bv.box, point);
  if (bv.region) return containsRegion(bv.region, point);
  if (bv.sphere) return containsSphere(bv.sphere, point);
  return false;
}

function containsSphere(sphere, point) {
  const [cx, cy, cz, r] = sphere;
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  const dz = point[2] - cz;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

// box format: [cx, cy, cz, ax, ay, az, bx, by, bz, cx2, cy2, cz2]
// center + 3 half-axis vectors. Point is inside iff its projection on each
// half-axis (normalized) has magnitude <= 1.
function containsBox(box, point) {
  const [cx, cy, cz,
         ax, ay, az,
         bx, by, bz,
         dx, dy, dz] = box;
  const px = point[0] - cx;
  const py = point[1] - cy;
  const pz = point[2] - cz;
  const projAxisSq = (vx, vy, vz) => {
    const lenSq = vx * vx + vy * vy + vz * vz;
    if (lenSq === 0) return Infinity;
    const dot = px * vx + py * vy + pz * vz;
    return (dot * dot) / (lenSq * lenSq); // (dot/lenSq)^2 — must be ≤ 1 (i.e. dot² ≤ lenSq²)
  };
  return projAxisSq(ax, ay, az) <= 1 && projAxisSq(bx, by, bz) <= 1 && projAxisSq(dx, dy, dz) <= 1;
}

// region format: [west, south, east, north, minH, maxH] in radians/meters.
function containsRegion(region, point) {
  const [west, south, east, north, minH, maxH] = region;
  const { lat, lon, height } = ecefToLonLat(point);
  return (
    lon >= west && lon <= east &&
    lat >= south && lat <= north &&
    height >= minH && height <= maxH
  );
}

// ─── 3. fetch + traverse the tileset tree ─────────────────────────────────
function withParams(url, params) {
  const u = new URL(url, TILES_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  return u.href;
}

function extractSession(text) {
  // Google embeds `?session=<TOKEN>` in every child URI inside the tileset
  // JSON. The token is opaque base64-ish (CMyuiaXomo-5eBCj_rTPBg etc.) and
  // ends at `&`, `"`, `}`, or whitespace — NOT at any character that may
  // appear inside the URL-encoded continuation of the JSON.
  if (typeof text !== 'string') return null;
  const m = text.match(/[?&]session=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchJson(url, apiKey, session) {
  const fullUrl = withParams(url, { key: apiKey, session });
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`Tile JSON fetch ${res.status} for ${fullUrl}`);
  const text = await res.text();
  // Try to capture session if present in any link inside the JSON.
  const sessionFromBody = extractSession(text);
  return { json: JSON.parse(text), session: sessionFromBody ?? session, baseUrl: fullUrl };
}

async function downloadGlb(url, apiKey, session, outPath) {
  const fullUrl = withParams(url, { key: apiKey, session });
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`GLB fetch ${res.status} for ${fullUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  return buf.byteLength;
}

function resolveChildUri(uri, parentBaseUrl) {
  // child URIs in Google tiles are relative to the parent JSON's URL.
  return new URL(uri, parentBaseUrl).href;
}

// 4×4 column-major matrix multiply (parent * child) → flat array of 16.
function multiplyMat4(parent, child) {
  if (!parent) return child ? [...child] : null;
  if (!child) return parent ? [...parent] : null;
  const r = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += parent[k * 4 + row] * child[col * 4 + k];
      }
      r[col * 4 + row] = s;
    }
  }
  return r;
}

const IDENTITY_MAT4 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

// Returns the DEEPEST tile (and its parent chain) whose boundingVolume contains
// the point. Mirrors the user-supplied `findTileContainingPoint` pseudocode:
// we descend into children first; if any child contains the point, recurse;
// otherwise the current tile is the leaf for this branch. We collect only the
// leaf tile's GLB (not every ancestor along the path).
async function findTilesForPoint({
  tile,
  pointECEF,
  parentBaseUrl,
  apiKey,
  session,
  depth = 0,
  maxDepth = 32,
  stats = { tilesetsFetched: 0, tilesetsFailed: 0 },
  parentTransform = null,
  collectMode = 'leaf', // 'leaf' = only deepest GLB per branch; 'all' = every match
}) {
  if (!tile.boundingVolume || !containsPoint(tile.boundingVolume, pointECEF)) {
    return { matches: [], session };
  }

  // Cumulative transform from world (ECEF) down to this tile's local frame.
  const tileTransform = tile.transform ?? null;
  const cumulativeTransform = multiplyMat4(parentTransform, tileTransform);

  const matches = [];
  let currentSession = session;
  let childMatches = [];

  // Tile content: GLB (leaf) OR JSON sub-tileset (recurse)
  if (tile.content?.uri) {
    const absUri = resolveChildUri(tile.content.uri, parentBaseUrl);
    if (/\.json(\?|$)/i.test(absUri)) {
      // Sub-tileset: fetch and recurse into its root.
      try {
        const { json: subTileset, session: newSession, baseUrl: subBase } =
          await fetchJson(absUri, apiKey, currentSession);
        stats.tilesetsFetched++;
        currentSession = newSession;
        const subRoot = subTileset.root ?? subTileset;
        const result = await findTilesForPoint({
          tile: subRoot,
          pointECEF,
          parentBaseUrl: subBase,
          apiKey,
          session: currentSession,
          depth: depth + 1,
          maxDepth,
          stats,
          parentTransform: cumulativeTransform,
          collectMode,
        });
        currentSession = result.session;
        childMatches.push(...result.matches);
      } catch (e) {
        stats.tilesetsFailed++;
        // Silent — failures are expected when child sub-tilesets are missing.
      }
    } else {
      // GLB content at this level — provisional, may be replaced by a deeper
      // child match in 'leaf' mode below.
      const ownGlb = {
        depth,
        geometricError: tile.geometricError,
        boundingVolumeType: tile.boundingVolume.box
          ? 'box'
          : tile.boundingVolume.region
            ? 'region'
            : 'sphere',
        uri: absUri,
        transform: cumulativeTransform ?? IDENTITY_MAT4,
      };
      if (collectMode === 'all') {
        matches.push(ownGlb);
      } else {
        // store in matches for now; replaced by deeper child match below if any
        matches.push(ownGlb);
      }
    }
  }

  if (tile.children && depth < maxDepth) {
    for (const child of tile.children) {
      const result = await findTilesForPoint({
        tile: child,
        pointECEF,
        parentBaseUrl,
        apiKey,
        session: currentSession,
        depth: depth + 1,
        maxDepth,
        stats,
        parentTransform: cumulativeTransform,
        collectMode,
      });
      currentSession = result.session;
      childMatches.push(...result.matches);
    }
  }

  if (collectMode === 'leaf') {
    // If a deeper tile in any child branch matched, prefer that over the
    // current GLB — this is the "find the most specific tile" semantics.
    if (childMatches.length > 0) {
      return { matches: childMatches, session: currentSession };
    }
    return { matches, session: currentSession };
  }
  // 'all' mode: include both this level's GLB and every descendant match.
  matches.push(...childMatches);

  return { matches, session: currentSession };
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  const address = process.argv[2] ?? '61 Bd Jean Moulin, 93190 Livry-Gargan, France';
  const argMaxDepth = Number(process.argv[3]) || 24;

  const env = loadEnv();
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY missing in .env.local');

  console.log(`\nAddress: ${address}\n`);

  console.log('[1/5] Geocoding…');
  const { lat, lng, formatted } = await geocode(address, apiKey);
  console.log(`      → ${formatted}`);
  console.log(`      → lat=${lat.toFixed(6)}, lng=${lng.toFixed(6)}`);

  console.log('[2/5] Converting to ECEF…');
  const point = lonLatToECEF(lng, lat, 60);
  console.log(`      → ECEF=(${point.map((v) => v.toFixed(1)).join(', ')})`);

  const slug = slugify(formatted);
  const outDir = join(PROJECT_ROOT, 'public', 'tiles', slug);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  console.log('[3/5] Fetching root tileset…');
  const { json: root, session, baseUrl: rootBase } = await fetchJson(ROOT_URL, apiKey, null);
  console.log(`      → root.geometricError=${root.geometricError ?? root.root?.geometricError}`);
  console.log(`      → session=${session ? session.slice(0, 16) + '…' : '(none yet)'}`);

  console.log(`[4/5] Traversing tree (max depth=${argMaxDepth})…`);
  const startedAt = Date.now();
  const stats = { tilesetsFetched: 0, tilesetsFailed: 0 };
  const { matches, session: finalSession } = await findTilesForPoint({
    tile: root.root ?? root,
    pointECEF: point,
    parentBaseUrl: rootBase,
    apiKey,
    session,
    maxDepth: argMaxDepth,
    stats,
  });
  console.log(
    `      → ${matches.length} matching GLB tiles  ` +
    `(sub-tilesets: ${stats.tilesetsFetched} ok, ${stats.tilesetsFailed} failed)  ` +
    `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  if (matches.length === 0) {
    console.warn('      ⚠ No tiles matched — point might be outside Google\'s coverage area.');
    return;
  }

  // Show LOD distribution.
  const byDepth = {};
  for (const m of matches) byDepth[m.depth] = (byDepth[m.depth] ?? 0) + 1;
  for (const d of Object.keys(byDepth).sort((a, b) => Number(a) - Number(b))) {
    console.log(`        depth ${d}: ${byDepth[d]} tiles`);
  }

  console.log(`[5/5] Downloading GLB files…`);
  const downloads = [];
  let totalBytes = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const file = `tile-d${String(m.depth).padStart(2, '0')}-${String(i).padStart(3, '0')}.glb`;
    const outPath = join(outDir, file);
    try {
      const bytes = await downloadGlb(m.uri, apiKey, finalSession, outPath);
      totalBytes += bytes;
      downloads.push({ ...m, file, bytes });
      process.stdout.write(`      ✓ ${file} (${(bytes / 1024).toFixed(1)} KB)\n`);
    } catch (e) {
      console.warn(`      ✗ ${file}: ${e.message}`);
    }
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        address: formatted,
        geocoded: { lat, lng },
        ecef: point,
        rootTileset: ROOT_URL,
        session: finalSession,
        maxDepth: argMaxDepth,
        tileCount: downloads.length,
        totalBytes,
        downloadedAt: new Date().toISOString(),
        tiles: downloads,
      },
      null,
      2,
    ),
  );

  console.log(
    `\nDone. ${downloads.length} tiles, ${(totalBytes / 1024 / 1024).toFixed(2)} MB → public/tiles/${slug}/\n`,
  );
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
