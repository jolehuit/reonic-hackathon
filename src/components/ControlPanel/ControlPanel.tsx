'use client';

import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';

const TOGGLES = [
  { key: 'ev', label: 'Electric car' },
  { key: 'heatpump', label: 'Heat pump' },
  { key: 'battery', label: 'Battery' },
  { key: 'wallbox', label: 'Wallbox' },
] as const;

export function ControlPanel() {
  const phase = useStore((s) => s.phase);
  const profile = useStore((s) => s.profile);
  const refinements = useStore((s) => s.refinements);
  const updateProfileField = useStore((s) => s.updateProfileField);
  const setRefinement = useStore((s) => s.setRefinement);
  const setPhase = useStore((s) => s.setPhase);

  if (phase !== 'interactive' || !profile) return null;

  const consumptionPct = Math.round(((profile.annualConsumptionKwh - 2000) / 8000) * 100);

  const toggleValues: Record<(typeof TOGGLES)[number]['key'], boolean> = {
    ev: profile.hasEv,
    heatpump: refinements.includeHeatPump,
    battery: refinements.includeBattery,
    wallbox: refinements.includeWallbox,
  };

  const handleToggle = (key: (typeof TOGGLES)[number]['key']) => {
    if (key === 'ev') updateProfileField('hasEv', !profile.hasEv);
    if (key === 'heatpump') setRefinement('includeHeatPump', !refinements.includeHeatPump);
    if (key === 'battery') setRefinement('includeBattery', !refinements.includeBattery);
    if (key === 'wallbox') setRefinement('includeWallbox', !refinements.includeWallbox);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex w-full max-w-3xl items-center gap-5 rounded-2xl border border-zinc-200/70 bg-white/95 px-6 py-3.5 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] backdrop-blur"
    >
      {/* Slider */}
      <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Annual consumption
          </label>
          <span className="font-mono text-[13px] font-bold tabular-nums text-zinc-900">
            {profile.annualConsumptionKwh.toLocaleString()}
            <span className="ml-1 text-[10.5px] font-medium text-zinc-400">kWh</span>
          </span>
        </div>
        <div className="relative h-2">
          <div className="absolute inset-0 rounded-full bg-zinc-200" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-all"
            style={{ width: `${consumptionPct}%` }}
          />
          <input
            type="range"
            min={2000}
            max={10000}
            step={100}
            value={profile.annualConsumptionKwh}
            onChange={(e) => updateProfileField('annualConsumptionKwh', Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
          <div
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500 bg-white shadow-sm"
            style={{ left: `${consumptionPct}%` }}
          />
        </div>
      </div>

      <div className="h-10 w-px bg-zinc-200" />

      {/* Toggles */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TOGGLES.map((t) => (
          <Toggle
            key={t.key}
            label={t.label}
            value={toggleValues[t.key]}
            onChange={() => handleToggle(t.key)}
          />
        ))}
      </div>

      <div className="h-10 w-px bg-zinc-200" />

      {/* CTA */}
      <button
        onClick={() => setPhase('reviewing')}
        className="group flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
      >
        Review &amp; Approve
        <svg
          className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </motion.div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onChange}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
        value
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
      }`}
    >
      {label}
      <span
        className={`inline-flex h-3.5 w-7 items-center rounded-full transition ${
          value ? 'bg-emerald-500' : 'bg-zinc-300'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={`h-2.5 w-2.5 rounded-full bg-white shadow ${value ? 'ml-3.5' : 'ml-0.5'}`}
        />
      </span>
    </motion.button>
  );
}
