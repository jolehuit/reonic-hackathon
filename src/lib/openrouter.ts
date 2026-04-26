// OpenRouter image-to-image helper for "isolated building" generation.
//
// SDXL + ControlNet (the user's preferred backend) isn't first-class on
// OpenRouter, so we use Gemini 2.5 Flash Image (Nano Banana) — the best
// img2img option available there for preserving the input structure while
// applying a stylistic / framing prompt. Falls back to other image-output
// models if the primary call fails.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const ISOLATION_PROMPT = [
  'TASK: Look at the input photogrammetric aerial image. Find the small RED',
  'DOT — it marks the target building. Identify the single building directly',
  'under (or closest to) the red dot. Crop tight to that building and OUTPUT',
  'a clean isolated render of ONLY that building, removing all surroundings',
  '(streets, neighbouring houses, trees, gardens, cars, fences, vegetation).',
  '',
  'OUTPUT REQUIREMENTS:',
  'single isolated building, no environment,',
  'perfect cutout, no background context,',
  '',
  'strict architectural accuracy — same roof shape, same walls, same windows,',
  'same proportions, same orientation as the input,',
  'no warping, no melted geometry, no AI artifacts,',
  '',
  'clean topology-like structure,',
  'sharp edges, consistent perspective (keep the same camera angle as input),',
  '',
  'photogrammetry reference style,',
  'realistic textures but geometry prioritized over style,',
  '',
  'studio lighting, neutral pure-white background,',
  '',
  'designed as input for 3D model generation,',
  'high fidelity, ultra sharp, no noise.',
  '',
  'DO NOT redesign the building. DO NOT add features that are not visible in',
  'the input. The output building must match the input building one-to-one,',
  'just isolated and cleaned.',
].join('\n');

// Models tried in order. GPT-Image-1 is what ChatGPT itself uses in 2026 for
// img2img edits and produces dramatically cleaner cutouts than the smaller
// Gemini image preview models — those stay as fallbacks for resilience.
const MODELS = [
  'openai/gpt-image-2',
];

interface OpenRouterImage {
  type: 'image_url';
  image_url: { url: string };
}

interface OpenRouterMessage {
  role: 'assistant';
  content: string | null;
  images?: OpenRouterImage[];
}

interface OpenRouterResponse {
  choices?: Array<{ message?: OpenRouterMessage }>;
  error?: { message?: string };
}

export async function isolateBuildingViaAI(image: Buffer): Promise<Buffer | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const body = {
    modalities: ['image', 'text'],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ISOLATION_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${image.toString('base64')}` },
          },
        ],
      },
    ],
  };

  for (const model of MODELS) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://reonic-hackathon.local',
          'X-Title': 'Reonic Hackathon — building isolation',
        },
        body: JSON.stringify({ model, ...body }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as OpenRouterResponse;
      const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!dataUrl) continue;
      const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) continue;
      return Buffer.from(m[1], 'base64');
    } catch {
      // try next model
    }
  }
  return null;
}
