// Auto-fill form with typewriter effect — OWNED by Dev C
// 5 fields fill themselves over ~3s when a house is selected.

'use client';

import { useEffect, useRef, useState } from 'react';
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
    isJumelee: false,
  },
  hamburg: {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
    isJumelee: false,
  },
  ruhr: {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
    isJumelee: true,
  },
};

const FIELD_DELAY_MS = 600; // typewriter stagger

export function ProfileForm() {
  const phase = useStore((s) => s.phase);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const updateProfileField = useStore((s) => s.updateProfileField);
  const setPhase = useStore((s) => s.setPhase);

  const [filledIdx, setFilledIdx] = useState(0);
  const startedFor = useRef<HouseId | null>(null);

  useEffect(() => {
    if (phase !== 'house-selected' || !selectedHouse) {
      startedFor.current = null;
      return;
    }
    if (startedFor.current === selectedHouse) return;
    startedFor.current = selectedHouse;

    setPhase('autofilling');

    const fields = 6;
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
  const isJumeleeFromStore = profile?.isJumelee ?? target.isJumelee;
  const canEdit = phase === 'ready-to-design';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-6 backdrop-blur min-w-[400px]">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Customer profile</h2>
      <div className="space-y-3 font-mono text-sm">
        <Row label="Annual consumption" value={filledIdx >= 1 ? `${target.annualConsumptionKwh} kWh` : ''} />
        <Row label="Inhabitants" value={filledIdx >= 2 ? `${target.inhabitants}` : ''} />
        <Row label="Electric vehicle" value={filledIdx >= 3 ? (target.hasEv ? `✓ Yes (${target.evAnnualKm} km)` : '✗ No') : ''} />
        <Row label="Existing heating" value={filledIdx >= 4 ? target.heatingType.toUpperCase() : ''} />
        <Row label="House size" value={filledIdx >= 5 ? `${target.houseSizeSqm} m²` : ''} />
        {filledIdx >= 6 && canEdit ? (
          <label
            className="flex cursor-pointer items-center justify-between border-b border-zinc-800 pb-1"
            title="Cochez si votre maison partage son toit avec un voisin (Doppelhaus). La surface PV disponible sera divisée par 2."
          >
            <span className="text-zinc-500">Maison jumelée</span>
            <span className="flex items-center gap-2 text-zinc-100">
              <input
                type="checkbox"
                checked={isJumeleeFromStore}
                onChange={(e) => updateProfileField('isJumelee', e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-amber-500"
              />
              {isJumeleeFromStore ? '✓ Oui (toit partagé)' : '✗ Non'}
            </span>
          </label>
        ) : (
          <Row
            label="Maison jumelée"
            value={filledIdx >= 6 ? (target.isJumelee ? '✓ Oui (toit partagé)' : '✗ Non') : ''}
          />
        )}
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
