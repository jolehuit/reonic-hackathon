// POST /api/parse-profile — OWNED by Dev B
// Wow-moment endpoint: user types natural-language description → structured profile.
//
// Strategy:
//   1. Try Pioneer's fine-tuned GLiNER2 (deterministic, ~80ms, multi-task single pass)
//   2. Fall back to Gemini structured output (~500ms, generative)
//
// Returns Partial<CustomerProfile> — UI fills the form fields that came back.

import { NextRequest, NextResponse } from 'next/server';
import { parseProfileFromNL } from '@/lib/pioneer';

interface ParseRequest {
  text: string;
}

export async function POST(req: NextRequest) {
  let body: ParseRequest;
  try {
    body = (await req.json()) as ParseRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Missing or empty `text`' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: '`text` too long (max 2000 chars)' }, { status: 400 });
  }

  try {
    const result = await parseProfileFromNL(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[parse-profile] both Pioneer and Gemini fallback failed:', err);
    return NextResponse.json(
      { error: 'Profile extraction failed. Check GOOGLE_GENERATIVE_AI_API_KEY env.' },
      { status: 500 },
    );
  }
}
