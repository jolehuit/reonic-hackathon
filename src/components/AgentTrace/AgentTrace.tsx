// Real-time view of the 3 actual pipeline steps (CAPTURE → SIZE → MODEL).
// Driven entirely by the AgentStep[] in the store, which Orchestrator.tsx
// updates as each underlying promise resolves. No fake durations, no fake
// substeps — what you see is what's actually happening.

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import type { AgentStep } from '@/lib/types';

// How long the centre-screen popup stays visible before morphing into the
// step's slot. Long enough to read but still snappy on cached runs.
const POPUP_HOLD_MS = 1300;

export function AgentTrace() {
  const steps = useStore((s) => s.agentSteps);

  // Single-popup queue: ensures popups always appear in top-down step order,
  // even if `size` (parallel lane) finishes before `capture`/`clean`. When
  // the active popup closes after POPUP_HOLD_MS, the next eligible step's
  // popup opens. `shownIds` powers two things: the queue's "already done"
  // check, and gating each card's in-slot artifact so it only appears once
  // the morph is ready to land (not during the upstream wait).
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [activePopupId, setActivePopupId] = useState<string | null>(null);

  // Reset memory when the pipeline restarts.
  useEffect(() => {
    const anyDone = steps.some((s) => s.status === 'done');
    if (!anyDone && (shownIds.size > 0 || activePopupId)) {
      setShownIds(new Set());
      setActivePopupId(null);
    }
  }, [steps, shownIds, activePopupId]);

  // Queue: when no popup is active, pick the next eligible step.
  useEffect(() => {
    if (activePopupId) return;
    const next = steps.find((s, i) => {
      if (s.status !== 'done') return false;
      if (shownIds.has(s.id)) return false;
      if (!s.artifactUrl && !s.resultLine) return false;
      for (let j = 0; j < i; j++) {
        const earlier = steps[j];
        if (earlier.status !== 'done' && earlier.status !== 'error') return false;
        const earlierEligible = !!earlier.artifactUrl || !!earlier.resultLine;
        if (earlierEligible && !shownIds.has(earlier.id)) return false;
      }
      return true;
    });
    if (next) setActivePopupId(next.id);
  }, [steps, activePopupId, shownIds]);

  // Timer: depends ONLY on activePopupId, so step updates during the hold
  // don't tear down the timeout (previous bug — effect cleanup cancelled the
  // close, then the early-return prevented re-arming, so the popup stuck).
  useEffect(() => {
    if (!activePopupId) return;
    const id = activePopupId;
    const t = setTimeout(() => {
      setShownIds((prev) => {
        const updated = new Set(prev);
        updated.add(id);
        return updated;
      });
      setActivePopupId(null);
    }, POPUP_HOLD_MS);
    return () => clearTimeout(t);
  }, [activePopupId]);

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
          <StepCard
            key={step.id}
            step={step}
            index={i + 1}
            popupOpen={activePopupId === step.id}
            popupShown={shownIds.has(step.id)}
          />
        ))}
      </ol>
    </motion.div>
  );
}

function StepCard({
  step,
  index,
  popupOpen,
  popupShown,
}: {
  step: AgentStep;
  index: number;
  popupOpen: boolean;
  /** True once this step's centre-screen popup has finished — gates the
      in-card slot artifact so it only appears with the morph animation. */
  popupShown: boolean;
}) {
  const isError = step.status === 'error';
  const isPending = step.status === 'pending';
  // A step is only treated as "validated" (✓ badge, emerald tone) once its
  // popup has either landed on screen or already closed. Until then — even if
  // the underlying API has resolved — we keep showing the running state, so
  // that the green tick lights up in sync with the popup, top-down.
  const validated = popupOpen || popupShown;
  const isDone = step.status === 'done' && validated;
  const isRunning = step.status === 'running' || (step.status === 'done' && !validated);

  const elapsed = useElapsedSeconds(isRunning);

  const tone = isError
    ? 'border-red-200 bg-red-50/60'
    : isDone
    ? 'border-emerald-200 bg-emerald-50/40'
    : isRunning
    ? 'border-blue-200 bg-blue-50/60'
    : 'border-zinc-200 bg-zinc-50/40';

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

  // Pulse ring keyframes fire on the running→done transition.
  const cardAnimate = isDone
    ? {
        boxShadow: [
          '0 0 0 0 rgba(16,185,129,0)',
          '0 0 0 8px rgba(16,185,129,0.32)',
          '0 0 0 0 rgba(16,185,129,0)',
        ],
      }
    : {};

  // Shared layoutIds connect the popup version to the in-card slot version,
  // so framer-motion morphs position+size between them when the popup closes.
  const imgLayoutId = `agent-artifact-${step.id}`;
  const pillLayoutId = `agent-result-${step.id}`;

  return (
    <>
      <motion.li
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0, ...cardAnimate }}
        transition={{ duration: 0.25, boxShadow: { duration: 0.9, ease: 'easeOut' } }}
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
          {/* In-card pill — appears only after this step's popup has finished
              (so the slot stays empty during the upstream wait) AND only if
              the popup is not currently open (so the morph is one-way). */}
          {isDone && step.resultLine && popupShown && !popupOpen && (
            <motion.div
              layoutId={pillLayoutId}
              className="mt-1.5 inline-block rounded-md bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              {step.resultLine}
            </motion.div>
          )}
          {isRunning && (
            <div className="mt-1 font-mono text-[10.5px] tabular-nums text-blue-600">
              {elapsed}s elapsed
            </div>
          )}
          {isError && (
            <div className="mt-1 text-[11px] text-red-700">Step failed — see server log</div>
          )}
        </div>
        {/* In-card thumbnail — gated on popupShown for the same reason as
            the result pill above. */}
        {isDone && step.artifactUrl && popupShown && !popupOpen && (
          <motion.img
            layoutId={imgLayoutId}
            src={step.artifactUrl}
            alt={step.label}
            className="h-14 w-14 flex-shrink-0 rounded-lg object-cover ring-1 ring-zinc-200"
          />
        )}
      </motion.li>

      <ResultPopup
        open={popupOpen}
        artifactUrl={step.artifactUrl}
        resultLine={step.resultLine}
        label={step.label}
        imgLayoutId={imgLayoutId}
        pillLayoutId={pillLayoutId}
      />
    </>
  );
}

function ResultPopup({
  open,
  artifactUrl,
  resultLine,
  label,
  imgLayoutId,
  pillLayoutId,
}: {
  open: boolean;
  artifactUrl?: string;
  resultLine?: string;
  label: string;
  imgLayoutId: string;
  pillLayoutId: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="popup-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            className="flex flex-col items-center gap-4 rounded-[28px] bg-white/95 p-8 shadow-[0_40px_100px_-20px_rgba(15,23,42,0.5)] ring-1 ring-emerald-300/60 backdrop-blur"
          >
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-emerald-600">
              Step complete
            </span>
            <span className="max-w-[420px] text-center text-[18px] font-semibold text-zinc-800">
              {label}
            </span>
            {artifactUrl && (
              <motion.img
                layoutId={imgLayoutId}
                src={artifactUrl}
                alt={label}
                className="h-[420px] w-[420px] rounded-3xl object-cover ring-1 ring-zinc-200"
              />
            )}
            {!artifactUrl && resultLine && (
              <motion.div
                layoutId={pillLayoutId}
                className="rounded-xl bg-white px-6 py-3 font-mono text-[26px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
              >
                {resultLine}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
