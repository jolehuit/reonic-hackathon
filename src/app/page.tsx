// Landing page — TEMP, replace with Lovable export by Dev C.
// 3 chips for demo houses + CTA.

import Link from 'next/link';
import type { HouseId } from '@/lib/types';

const HOUSES: { id: HouseId; label: string; description: string }[] = [
  { id: 'brandenburg', label: 'Brandenburg', description: '140 m² · gas heating · EV' },
  { id: 'hamburg', label: 'Hamburg', description: '165 m² · oil heating' },
  { id: 'ruhr', label: 'Ruhr', description: '190 m² · oil heating' },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-8 text-zinc-100">
      <div className="max-w-2xl text-center">
        <h1 className="mb-4 text-5xl font-bold tracking-tight">AI Renewable Designer</h1>
        <p className="mb-2 text-xl text-zinc-300">
          From address to signed offer in 30 seconds.
        </p>
        <p className="mb-12 text-sm text-zinc-500">Built on 1 620 real Reonic deliveries.</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {HOUSES.map((h) => (
            <Link
              key={h.id}
              href={`/design/${h.id}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-left transition hover:border-amber-500 hover:bg-zinc-900/80"
            >
              <div className="mb-1 text-lg font-semibold">{h.label}</div>
              <div className="text-sm text-zinc-400">{h.description}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
