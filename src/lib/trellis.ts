// fal-ai/trellis-2 wrapper. Image → 3D GLB via the raw fal REST APIs.
//
// We bypass @fal-ai/client because its fal.subscribe() / fal.storage.upload()
// hit a legacy auth pipeline that returns 403 Forbidden ("User is locked")
// even when the underlying REST endpoints accept the exact same key with 200.
// Pipeline (all confirmed working with raw fetch):
//   1. POST  rest.alpha.fal.ai/storage/upload/initiate → {file_url, upload_url}
//   2. PUT   upload_url with the PNG bytes → image is now hosted at file_url
//   3. POST  queue.fal.run/fal-ai/trellis-2 with {image_url: file_url}
//   4. Poll  status_url until COMPLETED, then GET response_url for the GLB.
// We also avoid base64 data URIs as image_url — fal rejects those for non-
// premium accounts with the same misleading "User is locked" message.

const STORAGE_INITIATE_URL = 'https://rest.alpha.fal.ai/storage/upload/initiate';
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

interface StorageInitiateResponse {
  file_url: string;
  upload_url: string;
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

function authHeader(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set');
  return `Key ${key}`;
}

export async function generateTrellisModel(input: TrellisInput): Promise<TrellisResult> {
  // 1. Initiate a signed upload.
  const initRes = await fetch(STORAGE_INITIATE_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file_name: 'oblique.png', content_type: 'image/png' }),
  });
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '');
    throw new Error(`storage initiate failed: HTTP ${initRes.status} ${body}`);
  }
  const { file_url, upload_url } = (await initRes.json()) as StorageInitiateResponse;
  if (!file_url || !upload_url) {
    throw new Error('storage initiate returned malformed body');
  }

  // 2. PUT the image bytes to the signed URL. No auth header — the signature
  // in the URL is the credential.
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(input.image),
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    throw new Error(`storage PUT failed: HTTP ${putRes.status} ${body}`);
  }

  // 3. Submit to the trellis-2 queue with the freshly hosted image URL.
  const submitRes = await fetch(`${QUEUE_BASE}/${MODEL_ID}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      image_url: file_url,
      decimation_target: 30000,
      texture_size: '1024',
      resolution: '1024',
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

  // 4. Poll status_url until terminal.
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

  // 5. Fetch the result.
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
