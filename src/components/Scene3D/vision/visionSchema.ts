// Zod schema mirroring VisionParams — OWNED by Dev A
// Used by the server action to constrain Gemini's structured output.
// Schema descriptions are part of the prompt — they guide the model.

import { z } from 'zod';

export const visionParamsSchema = z.object({
  storeyCount: z
    .number()
    .int()
    .min(1)
    .max(4)
    .describe('Visible full storeys above ground (excluding attic), 1 to 4.'),
  wallColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe('Dominant facade color, hex code (e.g. "#e8e2d4"). Pick a desaturated tone.'),
  roofColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe('Dominant roof tile color, hex code (e.g. "#8a3d2c").'),
  trimColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe('Window/door frame color, hex code. Usually white or dark brown.'),
  roofType: z
    .enum(['gable', 'hip', 'flat', 'mansard'])
    .describe('Predominant roof shape. Most German suburban homes are gable.'),
  facadeMaterial: z
    .enum(['render', 'brick', 'wood', 'stone'])
    .describe('Primary facade material visible in the photos.'),
  hasBalcony: z.boolean().describe('True if a balcony or projecting terrace is visible.'),
  hasDormer: z.boolean().describe('True if a dormer window is visible on the roof.'),
  hasChimney: z.boolean().describe('True if a chimney is visible.'),
  windowsPerFacade: z
    .number()
    .int()
    .min(0)
    .max(12)
    .describe('Approximate window count on the front facade.'),
  windowStyle: z
    .enum(['rectangular', 'square', 'arched'])
    .describe('Predominant window shape on the front facade.'),
  doorPosition: z
    .enum(['center', 'left', 'right'])
    .describe('Front door horizontal position on the front facade.'),
  hasGarage: z.boolean().describe('True if a separate garage door is visible.'),
  ridgeOrientation: z
    .enum(['eastwest', 'northsouth'])
    .describe('Roof ridge orientation in compass terms.'),
  roofOverhang: z
    .number()
    .min(0)
    .max(1.2)
    .describe('Eaves overhang in meters beyond the wall plane.'),
  notes: z
    .string()
    .max(200)
    .describe('Brief one-sentence architectural note useful for the procedural model.'),
});
