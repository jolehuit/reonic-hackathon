// Thin wrappers over the raw fal queue API for the two models we use:
//   - openai/gpt-image-2/edit                  → cleans the oblique
//     screenshot down to just the target building on a white background.
//   - fal-ai/hunyuan-3d/v3.1/pro/image-to-3d   → image-to-3D mesh (GLB).
//
// We bypass @fal-ai/client because some of its endpoints (storage upload,
// subscribe wrapper) return 403 Forbidden for keys the underlying REST
// endpoints accept fine. Going through queue.fal.run directly is simpler
// and removes one layer of magic.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const QUEUE_BASE = 'https://queue.fal.run';
// Generous polling window — Hunyuan 3D Pro can take 60-120s for a 500k-face
// mesh, GPT Image 2 can take 20-40s for high-quality edits.
const MAX_POLL_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;

// ─── FAL_KEY resolution ────────────────────────────────────────────────────
// In dev we additionally read .env.local off disk because a stale shell
// export of FAL_KEY (~/.zshrc, etc.) would otherwise win over the project's
// .env.local — Next gives precedence to process.env over .env files. In
// prod we just read process.env (no .env.local on Cloud Run / Vercel).
let cachedKey: string | null = null;
function readFalKey(): string {
  if (cachedKey) return cachedKey;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const envPath = resolve(process.cwd(), '.env.local');
      const text = readFileSync(envPath, 'utf8');
      const match = text.match(/^\s*FAL_KEY\s*=\s*(.+)$/m);
      if (match) {
        const v = match[1].trim().replace(/^['"]|['"]$/g, '');
        if (v) {
          cachedKey = v;
          console.log(`[fal] using FAL_KEY from .env.local (starts ${v.slice(0, 8)}…)`);
          return v;
        }
      }
    } catch {
      /* not present, fall through */
    }
  }
  const fallback = process.env.FAL_KEY;
  if (!fallback) throw new Error('FAL_KEY not set in process.env');
  cachedKey = fallback;
  return fallback;
}

function authHeader(): string {
  return `Key ${readFalKey()}`;
}

interface QueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}
interface QueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

/**
 * Generic fal queue runner: submit input → poll until terminal → fetch result.
 * The model decides the input/output shape; this function only knows the queue
 * envelope. Errors carry the failed step + HTTP code so the dev terminal log
 * is immediately diagnosable.
 */
async function runFalModel<I, O>(modelId: string, input: I): Promise<{ output: O; requestId: string }> {
  // 1. Submit
  const submitRes = await fetch(`${QUEUE_BASE}/${modelId}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`fal submit (${modelId}) failed: HTTP ${submitRes.status} ${body}`);
  }
  const { request_id, status_url, response_url } = (await submitRes.json()) as QueueSubmitResponse;
  if (!request_id || !status_url || !response_url) {
    throw new Error(`fal submit (${modelId}) returned malformed body`);
  }

  // 2. Poll
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(status_url, { headers: { Authorization: authHeader() } });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => '');
      throw new Error(`fal status (${modelId}) failed: HTTP ${statusRes.status} ${body}`);
    }
    const status = (await statusRes.json()) as QueueStatusResponse;
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      throw new Error(`fal ${modelId} ${status.status.toLowerCase()}: ${JSON.stringify(status)}`);
    }
  }
  if (Date.now() - startedAt >= MAX_POLL_MS) {
    throw new Error(`fal ${modelId} timed out after ${Math.round(MAX_POLL_MS / 1000)}s`);
  }

  // 3. Result
  const resultRes = await fetch(response_url, { headers: { Authorization: authHeader() } });
  if (!resultRes.ok) {
    const body = await resultRes.text().catch(() => '');
    throw new Error(`fal result (${modelId}) failed: HTTP ${resultRes.status} ${body}`);
  }
  const output = (await resultRes.json()) as O;
  return { output, requestId: request_id };
}

// ─── openai/gpt-image-2/edit ───────────────────────────────────────────────

interface GptImage2Output {
  images?: Array<{ url?: string; width?: number; height?: number }>;
}

const CLEAN_BUILDING_PROMPT = [
  'Isolate and extract ONLY the single residential building at the centre of',
  'this oblique aerial photograph. Remove all surrounding buildings, trees,',
  'parked cars, roads, fences, garden objects, power lines and ground',
  'textures. Replace the entire background with pure white (#ffffff).',
  'Preserve the target building exactly: roof shape, slope, walls, windows,',
  'doors, chimneys, materials, and colour palette. Keep the original oblique',
  'camera angle. The output must be a clean, photo-realistic isolated',
  'building suitable for 3D mesh reconstruction.',
].join(' ');

/**
 * Sends the oblique screenshot to OpenAI's GPT Image 2 (edit mode) with a
 * "clean & isolate" prompt. Returns a fal-hosted URL pointing at the cleaned
 * image, ready to feed straight into the Trellis queue. Only passes the
 * required input — everything else falls back to fal defaults
 * (image_size=auto, quality=high, num_images=1, output_format=png).
 */
export async function cleanBuildingImage(image: Buffer): Promise<{ imageUrl: string }> {
  const dataUri = `data:image/png;base64,${image.toString('base64')}`;
  const { output } = await runFalModel<unknown, GptImage2Output>('openai/gpt-image-2/edit', {
    prompt: CLEAN_BUILDING_PROMPT,
    image_urls: [dataUri],
  });
  const imageUrl = output.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`gpt-image-2 returned no image url: ${JSON.stringify(output)}`);
  }
  return { imageUrl };
}

// ─── fal-ai/hunyuan-3d/v3.1/pro/image-to-3d ────────────────────────────────

interface Hunyuan3dOutput {
  model_glb?: { url?: string };
  model_urls?: { glb?: { url?: string } };
  thumbnail?: { url?: string };
  seed?: number;
}

/**
 * Submits a hosted image URL to fal-ai/hunyuan-3d/v3.1/pro/image-to-3d and
 * returns the resulting GLB URL. Function name is kept as
 * `generateTrellisGlb` for backwards compatibility with existing call sites
 * — both routes (/api/trellis + /aerial's house-generator) just need a GLB
 * out of an image, regardless of which model produces it.
 */
export async function generateTrellisGlb(imageUrl: string): Promise<{ glbUrl: string; requestId: string }> {
  const { output, requestId } = await runFalModel<unknown, Hunyuan3dOutput>(
    'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d',
    {
      input_image_url: imageUrl,
      // Default is 500,000 faces — 30+ MB GLB that freezes the browser
      // for ~20s parsing + raycasting in <Panels/>. 50k faces is plenty
      // for a residential roof preview and brings parse + initial draw
      // under 1s on a mid-range laptop. Hunyuan accepts 40k-1.5M.
      face_count: 50_000,
    },
  );
  // Prefer the top-level model_glb (always present), fall back to the
  // alternate model_urls.glb shape just in case.
  const glbUrl = output.model_glb?.url ?? output.model_urls?.glb?.url;
  if (!glbUrl) throw new Error(`hunyuan-3d returned no glb url: ${JSON.stringify(output)}`);
  return { glbUrl, requestId };
}
