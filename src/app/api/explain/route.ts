// POST /api/explain — OWNED by Dev B
// Streams Gemini's explanation of the design decisions.

import { NextRequest } from 'next/server';
import { streamDesignExplanation } from '@/lib/gemini';
import type { CustomerProfile, DesignResult } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    profile: CustomerProfile;
    design: DesignResult;
  };

  const result = streamDesignExplanation(body.profile, body.design);
  return result.toTextStreamResponse();
}
