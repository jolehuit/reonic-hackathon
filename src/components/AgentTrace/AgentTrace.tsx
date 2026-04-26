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
// step's slot. The progress bar at the top of the popup fills in sync —
// 3 s gives the user time to actually read what just happened.
const POPUP_HOLD_MS = 3000;
// Once every step is done, fade the panel out after a short hold so the
// 3D viewer takes the full attention (the customer doesn't need to keep
// staring at "✓ ✓ ✓ 100%" while they explore the model).
const PIPELINE_DISMISS_DELAY_MS = 1500;

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

  const totalDone = steps.filter((s) => s.status === 'done').length;
  const totalErr = steps.filter((s) => s.status === 'error').length;
  const progressPct = steps.length > 0
    ? Math.round((totalDone / steps.length) * 100)
    : 0;
  const allValidated =
    steps.length > 0 &&
    totalErr === 0 &&
    totalDone === steps.length &&
    steps.every((s) => !s.artifactUrl && !s.resultLine ? true : shownIds.has(s.id));

  // Auto-dismiss the panel once every step is done AND its popup has shown.
  // Local state tracks whether we're allowed to render — once the timer
  // fires, the AnimatePresence below plays the exit animation and unmounts.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!allValidated) return;
    const t = setTimeout(() => setDismissed(true), PIPELINE_DISMISS_DELAY_MS);
    return () => clearTimeout(t);
  }, [allValidated]);

  // Re-arm if the pipeline restarts (steps cleared / re-running).
  useEffect(() => {
    if (steps.length === 0 || steps.some((s) => s.status !== 'done')) {
      setDismissed(false);
    }
  }, [steps]);

  if (steps.length === 0) return null;

  return (
    <AnimatePresence>
      {!dismissed && (
    <motion.div
      key="ai-pipeline-panel"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, scale: 0.96 }}
      transition={{ duration: 0.45 }}
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
      )}
    </AnimatePresence>
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
          transition={{ duration: 0.22 }}
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
        >
          {/* Soft radial bloom behind the card so the surrounding scene
              dims and the eye locks onto the popup. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(16,185,129,0.18) 0%, rgba(15,23,42,0.45) 50%, rgba(15,23,42,0.6) 100%)',
            }}
          />

          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 240, damping: 22 }}
            className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[32px] border border-emerald-200/60 bg-gradient-to-br from-white via-white to-emerald-50/70 p-9 shadow-[0_60px_140px_-30px_rgba(15,23,42,0.6)] backdrop-blur"
          >
            {/* Top progress bar — fills 0 → 100 % over POPUP_HOLD_MS so the
                user has a visible cue for how much time is left. */}
            <motion.div
              key="progress-bar"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: POPUP_HOLD_MS / 1000, ease: 'linear' }}
              className="absolute left-0 top-0 h-[3px] bg-gradient-to-r from-emerald-400 via-emerald-500 to-cyan-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]"
            />

            {/* Subtle animated glow ring */}
            <motion.div
              className="pointer-events-none absolute -inset-px rounded-[32px]"
              animate={{
                boxShadow: [
                  '0 0 0 0 rgba(16,185,129,0.0)',
                  '0 0 0 6px rgba(16,185,129,0.16)',
                  '0 0 0 0 rgba(16,185,129,0.0)',
                ],
              }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="flex items-center gap-2">
              <motion.span
                className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_2px_8px_rgba(16,185,129,0.4)]"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.1 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </motion.span>
              <span className="font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-emerald-700">
                Step complete
              </span>
            </div>
            <span className="max-w-[440px] text-center text-[19px] font-semibold leading-tight text-zinc-900">
              {label}
            </span>
            {artifactUrl && (
              <motion.img
                layoutId={imgLayoutId}
                src={artifactUrl}
                alt={label}
                className="h-[420px] w-[420px] rounded-3xl object-cover shadow-[0_20px_60px_-15px_rgba(15,23,42,0.45)] ring-1 ring-emerald-200/60"
              />
            )}
            {!artifactUrl && resultLine && (
              <motion.div
                layoutId={pillLayoutId}
                className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white px-7 py-4 font-mono text-[28px] font-bold text-emerald-700 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.4)] ring-1 ring-emerald-200"
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
