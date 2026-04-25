// fal-ai/trellis-2 wrapper. Image → 3D GLB.
// Tuned for web display: smaller mesh + texture so the GLB is < ~2MB.

import { fal } from '@fal-ai/client';

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const credentials = process.env.FAL_KEY;
  if (!credentials) throw new Error('FAL_KEY not set');
  fal.config({ credentials });
  configured = true;
}

export interface TrellisInput {
  /** PNG/JPEG buffer of the input image (oblique screenshot of the building). */
  image: Buffer;
  /** Optional file name for the upload. */
  fileName?: string;
}

export interface TrellisResult {
  glbUrl: string;
  requestId: string;
}

export async function generateTrellisModel(input: TrellisInput): Promise<TrellisResult> {
  ensureConfigured();

  // 1. Upload the input image to fal storage so trellis can fetch it.
  const file = new File([new Uint8Array(input.image)], input.fileName ?? 'oblique.png', {
    type: 'image/png',
  });
  const imageUrl = await fal.storage.upload(file);

  // 2. Subscribe to the queue and wait for the GLB. Trellis-2 takes ~30-60s.
  // Defaults from the docs except: target a web-friendly mesh size (30k verts,
  // 1024px texture) so the GLB streams quickly into the Three.js scene.
  const result = await fal.subscribe('fal-ai/trellis-2', {
    input: {
      image_url: imageUrl,
      decimation_target: 30000,
      texture_size: '1024',
      resolution: '1024',
    },
    logs: false,
  });

  const glbUrl = result.data?.model_glb?.url;
  if (!glbUrl) throw new Error('trellis returned no model_glb url');

  return { glbUrl, requestId: result.requestId };
}
