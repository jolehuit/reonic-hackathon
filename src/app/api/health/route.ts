// GET /api/health — uptime probe for Aikido scan / Vercel deploy
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
