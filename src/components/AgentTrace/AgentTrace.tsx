// Real-time view of the 3 actual pipeline steps (CAPTURE → SIZE → MODEL).
// Driven entirely by the AgentStep[] in the store, which Orchestrator.tsx
// updates as each underlying promise resolves. No fake durations, no fake
// substeps — what you see is what's actually happening.

'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import type { AgentStep } from '@/lib/types';

export function AgentTrace() {
  const steps = useStore((s) => s.agentSteps);

  if (steps.length === 0) return null;

  const totalDone = steps.filter((s) => s.status === 'done').length;
  const totalErr = steps.filter((s) => s.status === 'error').length;
  const progressPct = Math.round((totalDone / steps.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 }}
      className="flex w-[380px] flex-col overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      {/* Header */}
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  totalErr > 0 ? 'bg-red-400' : 'animate-ping bg-blue-400'
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  totalErr > 0 ? 'bg-red-500' : 'bg-blue-500'
                }`}
              />
            </span>
            <h2 className="text-[14px] font-bold tracking-tight text-zinc-900">
              AI pipeline
            </h2>
          </div>
          <span
            className={`font-mono text-[11px] font-bold ${
              totalErr > 0 ? 'text-red-600' : 'text-blue-600'
            }`}
          >
            {progressPct}%
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
          <motion.div
            className={`h-full ${totalErr > 0 ? 'bg-red-500' : 'bg-blue-500'}`}
            initial={{ width: '0%' }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Steps */}
      <ol className="flex flex-col gap-2 px-4 py-4">
        {steps.map((step, i) => (
          <StepCard key={step.id} step={step} index={i + 1} />
        ))}
      </ol>
    </motion.div>
  );
}

function StepCard({ step, index }: { step: AgentStep; index: number }) {
  const isDone = step.status === 'done';
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';
  const isPending = step.status === 'pending';

  const elapsed = useElapsedSeconds(isRunning);

  // Border + background tone reflects state.
  const tone = isError
    ? 'border-red-200 bg-red-50/60'
    : isDone
    ? 'border-emerald-200 bg-emerald-50/40'
    : isRunning
    ? 'border-blue-200 bg-blue-50/60'
    : 'border-zinc-200 bg-zinc-50/40';

  // Numbered status badge.
  const badge = isError ? (
    <BadgeIcon tone="error" content="!" />
  ) : isDone ? (
    <BadgeIcon tone="done" content="✓" />
  ) : isRunning ? (
    <BadgeSpinner />
  ) : (
    <BadgeIcon tone="pending" content={String(index)} />
  );

  const labelClass = isPending
    ? 'text-zinc-400'
    : isError
    ? 'text-red-800'
    : isDone
    ? 'text-zinc-800'
    : 'text-zinc-900';

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex items-start gap-3 rounded-2xl border p-3 transition ${tone}`}
    >
      <div className="flex-shrink-0 pt-0.5">{badge}</div>
      <div className="min-w-0 flex-1">
        <div className={`text-[13.5px] font-semibold leading-tight ${labelClass}`}>
          {step.label}
        </div>
        {step.sublabel && (
          <div className="mt-0.5 text-[11px] text-zinc-500">{step.sublabel}</div>
        )}
        {/* Result summary (e.g. "9.2 kWp · €11,400") shown when done. */}
        {isDone && step.resultLine && (
          <div className="mt-1.5 inline-block rounded-md bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            {step.resultLine}
          </div>
        )}
        {/* Live timer while running (only if the step is non-trivial). */}
        {isRunning && (
          <div className="mt-1 font-mono text-[10.5px] tabular-nums text-blue-600">
            {elapsed}s elapsed
          </div>
        )}
        {isError && (
          <div className="mt-1 text-[11px] text-red-700">Step failed — see server log</div>
        )}
      </div>
      {/* Artifact thumbnail (used by step 1 to show the captured screenshot). */}
      {isDone && step.artifactUrl && (
        <motion.img
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          src={step.artifactUrl}
          alt={step.label}
          className="h-14 w-14 flex-shrink-0 rounded-lg object-cover ring-1 ring-zinc-200"
        />
      )}
    </motion.li>
  );
}

function BadgeIcon({ tone, content }: { tone: 'done' | 'pending' | 'error'; content: string }) {
  const cls =
    tone === 'done'
      ? 'bg-emerald-500 text-white'
      : tone === 'error'
      ? 'bg-red-500 text-white'
      : 'bg-zinc-200 text-zinc-500';
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${cls}`}
    >
      {content}
    </span>
  );
}

function BadgeSpinner() {
  return (
    <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-white">
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-blue-300 border-t-transparent"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <span className="text-[10px] font-bold">·</span>
    </span>
  );
}

function useElapsedSeconds(active: boolean): number {
  const startedAt = useRef<number | null>(null);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setSecs(0);
      return;
    }
    startedAt.current = performance.now();
    const id = setInterval(() => {
      if (startedAt.current == null) return;
      setSecs(Math.floor((performance.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return secs;
}
