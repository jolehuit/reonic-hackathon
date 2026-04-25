// Auto-fill form with typewriter effect — OWNED by Dev C
// 5 fields fill themselves over ~3s when a house is selected.

'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { CustomerProfile, HouseId } from '@/lib/types';

// Pre-baked profiles per demo house — TODO Dev D will populate this from k-NN cluster
const HOUSE_PROFILES: Record<HouseId, CustomerProfile> = {
  brandenburg: {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: true,
    evAnnualKm: 15000,
    heatingType: 'gas',
    houseSizeSqm: 140,
  },
  hamburg: {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
  },
  'north-germany': {
    annualConsumptionKwh: 3800,
    inhabitants: 2,
    hasEv: true,
    evAnnualKm: 10000,
    heatingType: 'gas',
    houseSizeSqm: 110,
  },
  ruhr: {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
  },
};

const FIELD_DELAY_MS = 600; // typewriter stagger

export function ProfileForm() {
  const phase = useStore((s) => s.phase);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const setProfile = useStore((s) => s.setProfile);
  const setPhase = useStore((s) => s.setPhase);

  const [filledIdx, setFilledIdx] = useState(0);

  useEffect(() => {
    if (phase !== 'house-selected' || !selectedHouse) return;
    setPhase('autofilling');
    setFilledIdx(0);

    const fields = 5;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setFilledIdx(i);
      if (i >= fields) {
        clearInterval(interval);
        setProfile(HOUSE_PROFILES[selectedHouse]);
        setPhase('ready-to-design');
      }
    }, FIELD_DELAY_MS);

    return () => clearInterval(interval);
  }, [phase, selectedHouse, setProfile, setPhase]);

  if (phase === 'idle' || phase === 'agent-running' || phase === 'interactive' || phase === 'reviewing' || phase === 'approved') return null;
  if (!selectedHouse) return null;
  const target = HOUSE_PROFILES[selectedHouse];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-6 backdrop-blur min-w-[400px]">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Customer profile</h2>
      <div className="space-y-3 font-mono text-sm">
        <Row label="Annual consumption" value={filledIdx >= 1 ? `${target.annualConsumptionKwh} kWh` : ''} />
        <Row label="Inhabitants" value={filledIdx >= 2 ? `${target.inhabitants}` : ''} />
        <Row label="Electric vehicle" value={filledIdx >= 3 ? (target.hasEv ? `✓ Yes (${target.evAnnualKm} km)` : '✗ No') : ''} />
        <Row label="Existing heating" value={filledIdx >= 4 ? target.heatingType.toUpperCase() : ''} />
        <Row label="House size" value={filledIdx >= 5 ? `${target.houseSizeSqm} m²` : ''} />
      </div>
      {phase === 'ready-to-design' && (
        <button
          onClick={() => setPhase('agent-running')}
          className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
        >
          ▸ Generate design
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-zinc-800 pb-1">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-100">{value || <span className="text-zinc-700">_</span>}</span>
    </div>
  );
}
