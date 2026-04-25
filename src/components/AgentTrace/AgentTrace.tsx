// Agent Trace sidebar — OWNED by Dev C
// Streams the agent's decisions as text with status icons.

'use client';

import { useStore } from '@/lib/store';

export function AgentTrace() {
  const steps = useStore((s) => s.agentSteps);

  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-xs text-zinc-300 backdrop-blur">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Agent trace
      </div>
      {steps.map((step) => (
        <div key={step.id} className="flex items-start gap-2">
          <span className="w-3 text-zinc-500">
            {step.status === 'done' && '✓'}
            {step.status === 'running' && '↻'}
            {step.status === 'pending' && '·'}
            {step.status === 'error' && '✗'}
          </span>
          <span
            className={
              step.status === 'pending'
                ? 'text-zinc-600'
                : step.status === 'running'
                  ? 'text-amber-400'
                  : 'text-zinc-200'
            }
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
