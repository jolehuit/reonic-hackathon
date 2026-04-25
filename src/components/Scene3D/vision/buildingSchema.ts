// Zod schema for Gemini structured output — OWNED by Dev A
// Mirrors buildingTypes.ts. Field-level descriptions become part of the
// prompt, so write them as if speaking to the AI.

import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const openingSchema = z.object({
  type: z
    .enum(['window', 'door', 'garage_door'])
    .describe('window, door (front entry), or garage_door'),
  storey: z
    .number()
    .int()
    .min(0)
    .max(4)
    .describe('Floor index, 0 = ground floor'),
  horizontalPosition: z
    .number()
    .min(0)
    .max(1)
    .describe('Horizontal position on the facade. 0 = left edge, 0.5 = center, 1 = right edge.'),
  width: z.number().min(0.4).max(4).describe('Width in meters'),
  height: z.number().min(0.4).max(3).describe('Height in meters'),
  style: z
    .enum(['rectangular', 'square', 'arched', 'french-window'])
    .describe('Predominant opening style'),
  hasShutters: z
    .boolean()
    .describe('True if visible window shutters/persiennes are present'),
});

const facadeSchema = z.object({
  orientation: z.enum(['north', 'south', 'east', 'west']),
  visibility: z
    .enum(['clear', 'partial', 'obscured'])
    .describe('How well you can see this facade in the photos. obscured = not visible, hypothesize symmetric layout from visible facades.'),
  openings: z
    .array(openingSchema)
    .max(20)
    .describe('All windows/doors visible on this facade. Be exhaustive — count carefully.'),
});

const roofFeatureSchema = z.object({
  type: z.enum(['chimney', 'dormer', 'skylight']),
  positionX: z
    .number()
    .describe('X position in meters relative to the volume center (east-west).'),
  positionZ: z
    .number()
    .describe('Z position in meters relative to the volume center (north-south).'),
  width: z.number().min(0.3).max(3),
  heightAboveRoof: z.number().min(0.3).max(3),
  depth: z.number().min(0.3).max(3),
});

const roofSchema = z.object({
  type: z.enum(['gable', 'hip', 'flat', 'mansard', 'shed']),
  pitchDeg: z
    .number()
    .min(0)
    .max(60)
    .describe('Roof pitch in degrees. 0 for flat. Typical European gable = 30-40°.'),
  ridgeAxis: z
    .enum(['x', 'z'])
    .describe('x = east-west ridge (gables on east/west walls). z = north-south ridge (gables on north/south walls). For flat roofs use x.'),
  color: hexColor,
  overhangM: z
    .number()
    .min(0)
    .max(1.0)
    .describe('Eaves overhang in meters beyond the wall plane'),
  features: z
    .array(roofFeatureSchema)
    .max(6)
    .describe('Chimneys, dormers, skylights visible on this volume\'s roof'),
});

const volumeSchema = z.object({
  role: z
    .enum(['main', 'garage', 'extension'])
    .describe('main = principal residential block; garage = car space; extension = annex/wing'),
  centerX: z
    .number()
    .min(-30)
    .max(30)
    .describe('Volume center X coordinate in meters, relative to the main building origin (0,0). The main volume is usually at (0, 0).'),
  centerZ: z
    .number()
    .min(-30)
    .max(30)
    .describe('Volume center Z coordinate in meters'),
  width: z.number().min(2).max(30).describe('East-west width in meters'),
  depth: z.number().min(2).max(30).describe('North-south depth in meters'),
  storeyCount: z.number().int().min(1).max(4),
  storeyHeightM: z.number().min(2.2).max(3.5).describe('Per-storey height in meters. Typical residential = 2.7m'),
  wallColor: hexColor,
  facadeMaterial: z.enum(['render', 'brick', 'wood', 'stone']),
  roof: roofSchema,
  facades: z
    .array(facadeSchema)
    .length(4)
    .describe('Exactly 4 facades — one for each of north, south, east, west. Include all four even if some are obscured.'),
});

// Schema sent to Gemini (no `sources` field — that's filled in by the server).
export const buildingSchema = z.object({
  description: z
    .string()
    .max(300)
    .describe('Brief architectural description observed from the photos.'),
  volumes: z
    .array(volumeSchema)
    .min(1)
    .max(3)
    .describe('Distinct building volumes. Most houses are 1 main volume; add a garage volume only if visibly separate.'),
  trimColor: hexColor.describe('Window/door frame color, observed from photos'),
});
