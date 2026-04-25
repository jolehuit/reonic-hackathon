// Floating dev-mode badge — OWNED by Dev A
// Sits in the corner of the viewport while the vision pipeline runs so you
// can see exactly what Gemini is doing. Hidden in production.

'use client';

import { useSceneVision } from './vision/useSceneVision';

export function VisionStatusBadge() {
  const { status } = useSceneVision();
  if (process.env.NODE_ENV !== 'development') return null;

  const { label, hint } = describe(status);

  return (
    <div className="pointer-events-none absolute left-4 bottom-24 z-30 rounded-lg border border-zinc-700 bg-zinc-900/85 px-3 py-2 font-mono text-xs text-zinc-100 shadow-lg">
      <div className="flex items-center gap-2">
        <Dot status={status.kind} />
        <span className="font-semibold">Gemini Vision</span>
        <span className="text-zinc-400">— {label}</span>
      </div>
      {hint && <div className="mt-1 text-zinc-400">{hint}</div>}
    </div>
  );
}

function Dot({ status }: { status: ReturnType<typeof useSceneVision>['status']['kind'] }) {
  const color =
    status === 'ready'
      ? 'bg-emerald-400'
      : status === 'loading'
        ? 'bg-amber-400 animate-pulse'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-zinc-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function describe(
  status: ReturnType<typeof useSceneVision>['status'],
): { label: string; hint?: string } {
  switch (status.kind) {
    case 'idle':
      return { label: 'idle' };
    case 'loading':
      return { label: 'fetching captures + analyzing…' };
    case 'ready':
      return {
        label: `${status.mode} · ${status.inferenceMs} ms · ${status.capturesUsed} captures${status.fromCache ? ' · cached' : ''}`,
        hint: status.building.description,
      };
    case 'error':
      return { label: status.reason, hint: status.message };
  }
}
