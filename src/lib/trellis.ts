// fal-ai/trellis-2 wrapper. Image → 3D GLB via the raw fal queue API.
// Pipeline:
//   1. POST queue.fal.run/fal-ai/trellis-2 with {image_url: <base64 data URI>}
//   2. Poll status_url until COMPLETED, then GET response_url for the GLB.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const QUEUE_BASE = 'https://queue.fal.run';
const MODEL_ID = 'fal-ai/trellis-2';
// Cap the polling so a wedged request doesn't tie up the route forever.
// Trellis-2 typically completes in 30-60s; 4 minutes is generous.
const MAX_POLL_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;

export interface TrellisInput {
  /** PNG/JPEG buffer of the input image (oblique screenshot of the building). */
  image: Buffer;
}

export interface TrellisResult {
  glbUrl: string;
  requestId: string;
}

interface QueueSubmitResponse {
  status?: string;
  request_id: string;
  status_url: string;
  response_url: string;
}

interface QueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  queue_position?: number;
  logs?: Array<{ message: string }>;
  metrics?: Record<string, unknown>;
}

interface TrellisOutput {
  model_glb?: { url?: string };
}

// Reads FAL_KEY preferring .env.local over the shell-exported value, because
// it's easy to leave a stale `export FAL_KEY=...` in ~/.zshrc that silently
// overrides the project-local key (Next.js gives precedence to process.env
// over .env.local by design).
let cachedKey: string | null = null;
function readFalKey(): string {
  if (cachedKey) return cachedKey;
  let source = '?';
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    const text = readFileSync(envPath, 'utf8');
    const match = text.match(/^\s*FAL_KEY\s*=\s*(.+)$/m);
    if (match) {
      const v = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (v) {
        cachedKey = v;
        source = '.env.local';
        console.log(
          `[trellis] using FAL_KEY from ${source} (starts ${v.slice(0, 8)}…, len ${v.length})`,
        );
        return v;
      }
    }
  } catch (err) {
    console.log('[trellis] could not read .env.local:', err instanceof Error ? err.message : err);
  }
  const fallback = process.env.FAL_KEY;
  if (!fallback) throw new Error('FAL_KEY not set (looked in .env.local and process.env)');
  cachedKey = fallback;
  source = 'process.env';
  console.log(
    `[trellis] using FAL_KEY from ${source} (starts ${fallback.slice(0, 8)}…, len ${fallback.length})`,
  );
  return fallback;
}

function authHeader(): string {
  return `Key ${readFalKey()}`;
}

export async function generateTrellisModel(input: TrellisInput): Promise<TrellisResult> {
  // 1. Submit to the trellis-2 queue. Image goes inline as a base64 data URI.
  const dataUri = `data:image/png;base64,${input.image.toString('base64')}`;
  const submitRes = await fetch(`${QUEUE_BASE}/${MODEL_ID}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      image_url: dataUri,
      decimation_target: 30000,
      texture_size: 1024,
      resolution: 1024,
    }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`queue submit failed: HTTP ${submitRes.status} ${body}`);
  }
  const submit = (await submitRes.json()) as QueueSubmitResponse;
  const { request_id, status_url, response_url } = submit;
  if (!request_id || !status_url || !response_url) {
    throw new Error(`queue submit returned malformed body: ${JSON.stringify(submit)}`);
  }

  // 2. Poll status_url until terminal.
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_MS) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(status_url, {
      headers: { Authorization: authHeader() },
    });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => '');
      throw new Error(`queue status failed: HTTP ${statusRes.status} ${body}`);
    }
    const status = (await statusRes.json()) as QueueStatusResponse;
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      throw new Error(`trellis ${status.status.toLowerCase()}: ${JSON.stringify(status)}`);
    }
  }
  if (Date.now() - startedAt >= MAX_POLL_MS) {
    throw new Error(`trellis timed out after ${Math.round(MAX_POLL_MS / 1000)}s`);
  }

  // 3. Fetch the result.
  const resultRes = await fetch(response_url, {
    headers: { Authorization: authHeader() },
  });
  if (!resultRes.ok) {
    const body = await resultRes.text().catch(() => '');
    throw new Error(`queue result failed: HTTP ${resultRes.status} ${body}`);
  }
  const output = (await resultRes.json()) as TrellisOutput;
  const glbUrl = output.model_glb?.url;
  if (!glbUrl) throw new Error(`trellis returned no model_glb.url: ${JSON.stringify(output)}`);

  return { glbUrl, requestId: request_id };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
