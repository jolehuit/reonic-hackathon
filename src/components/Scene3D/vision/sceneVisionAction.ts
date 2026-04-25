// Server action — OWNED by Dev A
// Two modes for address → BuildingDescription:
//   - 'gemini'      : Gemini Vision estimates everything from photos.
//   - 'osm-hybrid'  : Fetch OSM footprint first → constrain Gemini with real
//                     dimensions/levels/roof shape from cadastral data.
// (3D Tiles mode bypasses this action entirely — handled client-side.)

'use server';

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { buildingSchema } from './buildingSchema';
import type { BuildingDescription, DataSources } from './buildingTypes';
import type { RoofGeometry } from '@/lib/types';
import { buildCacheKey, readCache, writeCache } from './visionCache';
import { fetchClosestBuilding } from './sources/osmFootprint';

const STATIC_MAPS_BASE = 'https://maps.googleapis.com/maps/api/staticmap';
const STREET_VIEW_BASE = 'https://maps.googleapis.com/maps/api/streetview';
const STREET_VIEW_META_BASE = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const CAPTURE_SIZE = '512x512';
const MODEL_VERSION = 'gemini-2.5-flash';

export type AnalysisMode = 'gemini' | 'osm-hybrid';

interface AnalyzeInput {
  lat: number;
  lng: number;
  address: string;
  analysis: RoofGeometry | null;
  mode: AnalysisMode;
}

interface AnalyzeResult {
  ok: true;
  building: BuildingDescription;
  inferenceMs: number;
  capturesUsed: number;
  fromCache: boolean;
  mode: AnalysisMode;
}

interface AnalyzeError {
  ok: false;
  reason: 'missing_maps_key' | 'missing_gemini_key' | 'capture_failed' | 'gemini_failed';
  message: string;
}

export async function analyzeBuilding(
  input: AnalyzeInput,
): Promise<AnalyzeResult | AnalyzeError> {
  const { key, analysisHash } = buildCacheKey({
    lat: input.lat,
    lng: input.lng,
    analysis: input.analysis,
    mode: input.mode,
  });
  const cached = readCache(key);
  if (cached?.building) {
    return {
      ok: true,
      building: cached.building,
      inferenceMs: cached.inferenceMs,
      capturesUsed: cached.captures.length,
      fromCache: true,
      mode: input.mode,
    };
  }

  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!mapsKey) return { ok: false, reason: 'missing_maps_key', message: 'GOOGLE_MAPS_API_KEY not set' };
  if (!geminiKey) return { ok: false, reason: 'missing_gemini_key', message: 'GOOGLE_GENERATIVE_AI_API_KEY not set' };

  const start = Date.now();

  // ─── 1. Optionally fetch OSM footprint (for osm-hybrid mode) ──────────
  const osmBuilding = input.mode === 'osm-hybrid' ? await fetchClosestBuilding(input.lat, input.lng) : null;

  // ─── 2. Resolve pano + bearing AT the building ────────────────────────
  let panoLat = input.lat;
  let panoLng = input.lng;
  let panoFound = false;
  try {
    const metaRes = await fetch(
      `${STREET_VIEW_META_BASE}?location=${input.lat},${input.lng}&key=${mapsKey}`,
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        status?: string;
        location?: { lat: number; lng: number };
      };
      if (meta.status === 'OK' && meta.location) {
        panoLat = meta.location.lat;
        panoLng = meta.location.lng;
        panoFound = true;
      }
    }
  } catch {
    /* fall back */
  }

  const heading = panoFound ? bearingDeg(panoLat, panoLng, input.lat, input.lng) : 0;

  // ─── 3. Build capture URLs ────────────────────────────────────────────
  const aerialUrl = `${STATIC_MAPS_BASE}?center=${input.lat},${input.lng}&zoom=20&size=${CAPTURE_SIZE}&maptype=satellite&markers=color:red%7Csize:mid%7C${input.lat},${input.lng}&key=${mapsKey}`;
  const headings = panoFound
    ? [normalizeDeg(heading - 25), heading, normalizeDeg(heading + 25)]
    : [0, 90, 180];
  const sv = (h: number) =>
    `${STREET_VIEW_BASE}?size=${CAPTURE_SIZE}&location=${input.lat},${input.lng}&heading=${h.toFixed(1)}&pitch=15&fov=80&key=${mapsKey}`;

  let captures: ArrayBuffer[];
  try {
    captures = await Promise.all([
      fetch(aerialUrl).then(safeBuffer),
      ...headings.map((h) => fetch(sv(h)).then(safeBuffer)),
    ]);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: 'capture_failed',
      message: e instanceof Error ? e.message : 'unknown',
    };
  }

  const captureUris = captures.map(toJpegDataUri);
  const [aerial, svLeft, svFront, svRight] = captureUris;

  // ─── 4. Compose architectural prompt — adds OSM constraints when present
  const promptLines: string[] = [
    `You are an experienced architect tasked with producing a detailed 3D model description of a single residential building.`,
    `Address: ${input.address} (lat ${input.lat.toFixed(4)}, lng ${input.lng.toFixed(4)}).`,
    panoFound
      ? `Street View captures are AIMED AT the property at heading ${Math.round(heading)}° ± 25°. The red marker on the satellite view pinpoints the exact building.`
      : `No Street View pano was available; only the satellite view is reliable.`,
    ``,
  ];

  if (osmBuilding) {
    const polygonStr = osmBuilding.polygonMeshXZ
      .map(([x, z]) => `(${x.toFixed(2)}, ${z.toFixed(2)})`)
      .join(', ');
    promptLines.push(
      `IMPORTANT — OpenStreetMap cadastral data for this exact building (osmId=${osmBuilding.osmId}):`,
      `  Footprint polygon (mesh-local meters, x=east z=south): ${polygonStr}`,
      `  Bounding box: width ${osmBuilding.widthM.toFixed(2)} m × depth ${osmBuilding.depthM.toFixed(2)} m`,
      `  Centroid offset from input lat/lng: east ${osmBuilding.centroidOffsetM.east.toFixed(2)} m, north ${osmBuilding.centroidOffsetM.north.toFixed(2)} m`,
      osmBuilding.tags.levels !== undefined
        ? `  building:levels = ${osmBuilding.tags.levels} (use this exactly for storeyCount)`
        : '  building:levels not tagged (estimate from photos)',
      osmBuilding.tags.height !== undefined
        ? `  height = ${osmBuilding.tags.height} m (use this to derive storey heights)`
        : '',
      osmBuilding.tags.roofShape ? `  roof:shape = ${osmBuilding.tags.roofShape}` : '',
      osmBuilding.tags.roofMaterial ? `  roof:material = ${osmBuilding.tags.roofMaterial}` : '',
      ``,
      `Use the OSM bounding box dimensions (width, depth) verbatim for the main volume.`,
      `Use OSM tag values when present (storey count, roof shape) — they are authoritative.`,
      `Use Gemini Vision only for what OSM does NOT specify: colors, exact opening positions, materials, decorative elements.`,
      ``,
    );
  } else if (input.mode === 'osm-hybrid') {
    promptLines.push(
      `WARNING: OSM lookup failed — falling back to Vision-only estimation.`,
      ``,
    );
  }

  promptLines.push(
    `Captures provided, in order:`,
    `  1. Top-down satellite view (zoom 20) with a red marker on the target.`,
    `  2. Street View aimed slightly LEFT of the target.`,
    `  3. Street View aimed DIRECTLY at the target.`,
    `  4. Street View aimed slightly RIGHT of the target.`,
    ``,
    `Your job:`,
    `- Determine the principal volume's storey count, wall and roof colors, materials.`,
    `- For each of the 4 facades (north, south, east, west):`,
    `    * Mark visibility ('clear' / 'partial' / 'obscured').`,
    `    * List ALL visible windows and doors with horizontalPosition (0..1), per-storey, with realistic dimensions.`,
    `    * Be exhaustive — for European houses 4-8 windows per facade is typical.`,
    `- Locate roof features: chimneys, dormers, skylights.`,
    ``,
    `Conventions:`,
    `- The principal volume must be centered at (centerX=0, centerZ=0).`,
    `- Use desaturated, realistic European hex colors observed in photos.`,
  );

  const prompt = promptLines.filter((line) => line !== '').join('\n');

  let aiOutput: Omit<BuildingDescription, 'sources'>;
  try {
    const { object } = await generateObject({
      model: google(MODEL_VERSION),
      schema: buildingSchema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image: aerial },
            { type: 'image', image: svLeft },
            { type: 'image', image: svFront },
            { type: 'image', image: svRight },
          ],
        },
      ],
    });
    aiOutput = object;
  } catch (e: unknown) {
    return {
      ok: false,
      reason: 'gemini_failed',
      message: e instanceof Error ? e.message : 'unknown',
    };
  }

  // ─── 5. If OSM, override main volume dimensions with the cadastral truth ─
  if (osmBuilding && aiOutput.volumes.length > 0) {
    const main = aiOutput.volumes.find((v) => v.role === 'main') ?? aiOutput.volumes[0];
    main.width = osmBuilding.widthM;
    main.depth = osmBuilding.depthM;
    if (osmBuilding.tags.levels !== undefined) {
      main.storeyCount = osmBuilding.tags.levels;
    }
    if (osmBuilding.tags.height !== undefined && main.storeyCount > 0) {
      main.storeyHeightM = osmBuilding.tags.height / main.storeyCount;
    }
  }

  const sources: DataSources = {
    geminiVision: true,
    osmFootprint: osmBuilding
      ? {
          osmId: osmBuilding.osmId,
          polygonMeshXZ: osmBuilding.polygonMeshXZ,
          centroidOffset: osmBuilding.centroidOffsetM,
          levelsTag: osmBuilding.tags.levels,
          heightTag: osmBuilding.tags.height,
          roofShapeTag: osmBuilding.tags.roofShape,
        }
      : null,
  };

  const building: BuildingDescription = { ...aiOutput, sources };

  const inferenceMs = Date.now() - start;

  writeCache(key, {
    version: 2,
    createdAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    input: {
      lat: input.lat,
      lng: input.lng,
      address: input.address,
      analysisHash,
      mode: input.mode,
    },
    captures: captureUris,
    building,
    inferenceMs,
  });

  return {
    ok: true,
    building,
    inferenceMs,
    capturesUsed: captures.length,
    fromCache: false,
    mode: input.mode,
  };
}

function bearingDeg(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(latA);
  const φ2 = toRad(latB);
  const Δλ = toRad(lngB - lngA);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

async function safeBuffer(r: Response): Promise<ArrayBuffer> {
  if (!r.ok) throw new Error(`Google Maps fetch failed: HTTP ${r.status}`);
  return r.arrayBuffer();
}

function toJpegDataUri(buf: ArrayBuffer): string {
  const b64 = Buffer.from(buf).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}
