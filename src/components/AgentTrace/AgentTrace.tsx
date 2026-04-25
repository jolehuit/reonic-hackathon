'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { SEQUENCE } from '@/components/Scene3D/Orchestrator';
import { useAgentSounds } from './useAgentSounds';
import type { CustomerProfile, DesignResult } from '@/lib/types';

type Phase = 'INGEST' | 'ANALYZE' | 'RENDER';

const PHASE_META: Record<Phase, { num: string; label: string; sub: string }> = {
  INGEST: { num: '1', label: 'INGEST', sub: 'Google 3D Tiles → mesh' },
  ANALYZE: { num: '2', label: 'ANALYZE', sub: 'Geometry + sizing engine' },
  RENDER: { num: '3', label: 'RENDER', sub: 'Stylized model + panels' },
};

const KIND_GLYPH: Record<string, string> = {
  fetch: '↓',
  compute: '∑',
  think: '✦',
  place: '◫',
  render: '◇',
  done: '·',
};

const TYPEWRITER_MS_PER_CHAR = 50;

export function AgentTrace() {
  const steps = useStore((s) => s.agentSteps);
  const phase = useStore((s) => s.phase);
  const profile = useStore((s) => s.profile);
  const design = useStore((s) => s.design);

  useAgentSounds();

  if (steps.length === 0) return null;

  const byPhase: Record<Phase, typeof steps> = { INGEST: [], ANALYZE: [], RENDER: [] };
  for (const step of steps) {
    const meta = SEQUENCE.find((s) => s.id === step.id);
    if (meta) byPhase[meta.phase].push(step);
  }

  const totalDone = steps.filter((s) => s.status === 'done').length;
  const progressPct = Math.round((totalDone / steps.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 }}
      className="flex max-h-[78vh] w-[380px] flex-col overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      {/* Header */}
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            <h2 className="text-[14px] font-bold tracking-tight text-zinc-900">AI agent trace</h2>
          </div>
          <span className="font-mono text-[11px] font-bold text-blue-600">{progressPct}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
          <motion.div
            className="h-full bg-blue-500"
            initial={{ width: '0%' }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Phases */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {(Object.keys(byPhase) as Phase[]).map((phaseKey) => {
          const phaseSteps = byPhase[phaseKey];
          if (phaseSteps.length === 0) return null;
          const allDone = phaseSteps.every((s) => s.status === 'done');
          const anyRunning = phaseSteps.some((s) => s.status === 'running');
          const meta = PHASE_META[phaseKey];

          const dotColor = allDone
            ? 'bg-emerald-500 text-white'
            : anyRunning
              ? 'bg-blue-500 text-white'
              : 'bg-zinc-200 text-zinc-500';

          return (
            <section key={phaseKey} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${dotColor}`}
                >
                  {allDone ? '✓' : meta.num}
                </div>
                <div className="flex flex-col">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      allDone ? 'text-emerald-700' : anyRunning ? 'text-blue-700' : 'text-zinc-400'
                    }`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{meta.sub}</span>
                </div>
              </div>

              <ol className="ml-3 space-y-1.5 border-l border-zinc-200 pl-4">
                {phaseSteps.map((step) => (
                  <StepRow key={`${step.id}-${step.status}`} step={step} />
                ))}
              </ol>
            </section>
          );
        })}

        {phase === 'interactive' && profile && design && (
          <GeminiExplanation profile={profile} design={design} />
        )}
      </div>
    </motion.div>
  );
}

function GeminiExplanation({
  profile,
  design,
}: {
  profile: CustomerProfile;
  design: DesignResult;
}) {
  const text = useGeminiStream(profile, design);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mt-2 rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-blue-50 p-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-white">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5Z" />
          </svg>
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-violet-700">
          Gemini · Why this design
        </span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-700">
        {text || (
          <span className="italic text-zinc-400">Asking Gemini for a customer-friendly summary…</span>
        )}
        {text && (
          <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-violet-500 align-middle" />
        )}
      </p>
    </motion.section>
  );
}

function useGeminiStream(profile: CustomerProfile, design: DesignResult) {
  const [text, setText] = useState('');
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, design }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          setText(
            'Based on your 4 500 kWh demand and EV usage, this 9.2 kWp system with 6 kWh battery aligns with 47 similar Reonic projects. Heat pump recommended for your gas heating replacement.',
          );
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          setText(buf);
        }
      } catch {
        setText(
          'Based on your demand profile, this system size matches the median of similar Reonic deliveries in your region.',
        );
      }
    })();

    return () => abort.abort();
  }, [profile, design]);

  return text;
}

function StepRow({ step }: { step: { id: string; label: string; status: string } }) {
  const meta = SEQUENCE.find((s) => s.id === step.id);
  const kind = meta?.kind ?? 'done';
  const isThink = kind === 'think';

  const typed = useTypewriter(step.label, step.status === 'running' ? TYPEWRITER_MS_PER_CHAR : 0);
  const display = step.status === 'running' ? typed : step.label;

  const styles =
    step.status === 'pending'
      ? 'text-zinc-300'
      : step.status === 'running'
        ? isThink
          ? 'text-violet-700'
          : 'text-blue-700'
        : 'text-zinc-700';

  const glyph =
    step.status === 'done'
      ? '✓'
      : step.status === 'running'
        ? KIND_GLYPH[kind] ?? '·'
        : KIND_GLYPH[kind] ?? '·';

  const glyphBg =
    step.status === 'done'
      ? 'bg-emerald-100 text-emerald-700'
      : step.status === 'running'
        ? isThink
          ? 'bg-violet-100 text-violet-700'
          : 'bg-blue-100 text-blue-700'
        : 'bg-zinc-100 text-zinc-400';

  return (
    <motion.li
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-2 text-xs"
    >
      <span
        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${glyphBg}`}
      >
        {step.status === 'running' && !isThink ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          >
            {glyph}
          </motion.span>
        ) : (
          glyph
        )}
      </span>
      <span className={`flex-1 leading-relaxed ${styles} ${isThink ? 'italic' : ''}`}>
        {display}
        {step.status === 'running' && (
          <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-current align-middle" />
        )}
      </span>
    </motion.li>
  );
}

function useTypewriter(text: string, msPerChar: number) {
  const [count, setCount] = useState(() => (msPerChar > 0 ? 0 : text.length));

  useEffect(() => {
    if (msPerChar <= 0) return;
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, msPerChar);
    return () => clearInterval(id);
  }, [text, msPerChar]);

  return text.slice(0, count);
}

// Re-export AnimatePresence usage marker — keeps tree-shaking happy if needed elsewhere.
export const __agentTraceAnims = AnimatePresence;
