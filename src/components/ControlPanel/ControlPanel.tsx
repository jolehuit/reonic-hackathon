// Control panel: sliders + toggles — OWNED by Dev C
'use client';

import { useStore } from '@/lib/store';

export function ControlPanel() {
  const phase = useStore((s) => s.phase);
  const profile = useStore((s) => s.profile);
  const refinements = useStore((s) => s.refinements);
  const updateProfileField = useStore((s) => s.updateProfileField);
  const setRefinement = useStore((s) => s.setRefinement);
  const setPhase = useStore((s) => s.setPhase);

  if (phase !== 'interactive' || !profile) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
      <div className="flex flex-col gap-1">
        <label className="text-xs uppercase text-zinc-500">Annual consumption</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={2000}
            max={10000}
            step={100}
            value={profile.annualConsumptionKwh}
            onChange={(e) => updateProfileField('annualConsumptionKwh', Number(e.target.value))}
            className="w-48"
          />
          <span className="font-mono text-sm text-zinc-200">{profile.annualConsumptionKwh} kWh</span>
        </div>
      </div>

      <Toggle label="EV" value={profile.hasEv} onChange={(v) => updateProfileField('hasEv', v)} />
      <Toggle label="Heat pump" value={refinements.includeHeatPump} onChange={(v) => setRefinement('includeHeatPump', v)} />
      <Toggle label="Battery" value={refinements.includeBattery} onChange={(v) => setRefinement('includeBattery', v)} />
      <Toggle label="Wallbox" value={refinements.includeWallbox} onChange={(v) => setRefinement('includeWallbox', v)} />

      <button
        onClick={() => setPhase('reviewing')}
        className="ml-auto rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
      >
        Review &amp; Approve
      </button>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`rounded-lg border px-3 py-2 text-sm transition ${
        value
          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
          : 'border-zinc-800 bg-zinc-900 text-zinc-500'
      }`}
    >
      {label}
    </button>
  );
}
