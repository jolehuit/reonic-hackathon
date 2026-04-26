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
  const panelEditMode = useStore((s) => s.panelEditMode);
  const setPanelEditMode = useStore((s) => s.setPanelEditMode);
  const editedPanels = useStore((s) => s.editedPanels);
  const panelTargetCount = useStore((s) => s.panelTargetCount);
  const removeEditedPanel = useStore((s) => s.removeEditedPanel);
  const resetEditedPanels = useStore((s) => s.resetEditedPanels);

  if (phase !== 'interactive' || !profile) return null;

  const panelCount = editedPanels?.length ?? panelTargetCount;
  const removeLastPanel = () => {
    if (!editedPanels || editedPanels.length === 0) return;
    removeEditedPanel(editedPanels[editedPanels.length - 1].id);
  };

  // Edit-mode bar replaces the sizing controls so the user is focused on the
  // layout (count + drag). Done returns to the standard refinements row.
  if (panelEditMode) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex w-full max-w-3xl items-center gap-5 rounded-2xl border border-blue-200/70 bg-white/95 px-6 py-3.5 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] backdrop-blur"
      >
        <div className="flex flex-1 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[12.5px] font-semibold text-zinc-900">
              Edit layout
            </span>
            <span className="text-[10.5px] text-zinc-500">
              Click a panel to remove · drag to reposition · click bare roof to add
            </span>
          </div>
        </div>

        <div className="h-10 w-px bg-zinc-200" />

        <div className="flex items-center gap-2">
          <button
            onClick={removeLastPanel}
            disabled={panelCount === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Remove last panel"
          >
            −
          </button>
          <span className="min-w-[2.75rem] text-center font-mono text-[14px] font-bold tabular-nums text-zinc-900">
            {panelCount}
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-zinc-400">
            panels
          </span>
        </div>

        <div className="h-10 w-px bg-zinc-200" />

        <button
          onClick={resetEditedPanels}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-[12px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          Reset to auto
        </button>

        <button
          onClick={() => setPanelEditMode(false)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Done
        </button>
      </motion.div>
    );
  }

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
      className="flex w-full max-w-5xl items-center gap-5 rounded-2xl border border-zinc-200/70 bg-white/95 px-6 py-3.5 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] backdrop-blur"
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

      {/* Edit-layout entry */}
      <button
        onClick={() => setPanelEditMode(true)}
        className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        Edit layout
      </button>

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
