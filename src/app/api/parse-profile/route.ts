// POST /api/parse-profile — OWNED by Dev B
// NL text → Partial<CustomerProfile> via Gemini structured output (zod-typed schema).
// Wired but currently unused — Dev C's form is field-based, not NL-based. Kept for the
// stretch wow-moment where the user types a sentence and the form auto-fills.

import { NextRequest, NextResponse } from 'next/server';
import { parseProfileWithGemini } from '@/lib/gemini';

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

  const start = performance.now();
  try {
    const profile = await parseProfileWithGemini(text);
    return NextResponse.json({
      profile,
      source: 'gemini-structured-output',
      inferenceMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    console.error('[parse-profile] Gemini extraction failed:', err);
    return NextResponse.json(
      { error: 'Profile extraction failed. Check GOOGLE_GENERATIVE_AI_API_KEY env.' },
      { status: 500 },
    );
  }
}
