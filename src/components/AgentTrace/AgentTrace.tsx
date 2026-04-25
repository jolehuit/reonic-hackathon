// Agent Trace sidebar — OWNED by Dev C
// Streams the agent's thinking + computing + rendering steps in 3 visible phases.
// Goal: jurors literally see the AI work — from 3D Tiles fetch → analysis → final render.

'use client';

import { useStore } from '@/lib/store';
import { SEQUENCE } from '@/components/Scene3D/Orchestrator';

type Phase = 'INGEST' | 'ANALYZE' | 'RENDER';

const PHASE_LABELS: Record<Phase, string> = {
  INGEST:  '1 · INGEST   Google 3D Tiles → mesh',
  ANALYZE: '2 · ANALYZE  geometry + sizing engine',
  RENDER:  '3 · RENDER   stylized model + panels',
};

const KIND_ICON: Record<string, { idle: string; running: string }> = {
  fetch:   { idle: '⤓', running: '⟳' },
  compute: { idle: '∑', running: '∑' },
  think:   { idle: '✦', running: '✦' },
  place:   { idle: '◫', running: '◫' },
  render:  { idle: '◇', running: '◆' },
  done:    { idle: '·', running: '·' },
};

export function AgentTrace() {
  const steps = useStore((s) => s.agentSteps);

  if (steps.length === 0) return null;

  // Group steps by phase using SEQUENCE metadata
  const byPhase: Record<Phase, typeof steps> = { INGEST: [], ANALYZE: [], RENDER: [] };
  for (const step of steps) {
    const meta = SEQUENCE.find((s) => s.id === step.id);
    if (meta) byPhase[meta.phase].push(step);
  }

  return (
    <div className="flex max-h-[80vh] flex-col gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/85 p-4 font-mono text-xs text-zinc-300 backdrop-blur">
      <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
        AI agent trace
      </div>
      {(Object.keys(byPhase) as Phase[]).map((phaseKey) => {
        const phaseSteps = byPhase[phaseKey];
        if (phaseSteps.length === 0) return null;
        const allDone = phaseSteps.every((s) => s.status === 'done');
        const anyRunning = phaseSteps.some((s) => s.status === 'running');
        return (
          <section key={phaseKey} className="flex flex-col gap-1">
            <div
              className={`text-[10px] uppercase tracking-wider ${
                allDone ? 'text-emerald-400/70' : anyRunning ? 'text-amber-400' : 'text-zinc-600'
              }`}
            >
              {PHASE_LABELS[phaseKey]}
            </div>
            {phaseSteps.map((step) => {
              const meta = SEQUENCE.find((s) => s.id === step.id);
              const kind = meta?.kind ?? 'done';
              const icons = KIND_ICON[kind];
              const isThink = kind === 'think';
              const colorByStatus =
                step.status === 'pending'
                  ? 'text-zinc-700'
                  : step.status === 'running'
                    ? isThink
                      ? 'text-violet-300'
                      : 'text-amber-300'
                    : 'text-zinc-300';
              const symbol =
                step.status === 'done'
                  ? '✓'
                  : step.status === 'running'
                    ? icons.running
                    : icons.idle;
              return (
                <div key={step.id} className={`flex items-start gap-2 pl-2 ${colorByStatus}`}>
                  <span className="w-3 shrink-0 text-zinc-500">{symbol}</span>
                  <span className={isThink ? 'italic' : ''}>{step.label}</span>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
