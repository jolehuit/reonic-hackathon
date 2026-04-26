'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { HOUSE_LOCATION, HOUSE_PROFILES } from '@/lib/houses';
import type { CustomerProfile, HouseId } from '@/lib/types';
import { CustomAddressForm } from './CustomAddressForm';

type CustomMode = 'choosing' | 'auto' | 'manual';

export function ProfileForm() {
  const phase = useStore((s) => s.phase);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const customAddress = useStore((s) => s.customAddress);
  const setPhase = useStore((s) => s.setPhase);
  const setProfile = useStore((s) => s.setProfile);
  const profile = useStore((s) => s.profile);

  const isDemoHouse =
    selectedHouse === 'berlin-dahlem' ||
    selectedHouse === 'potsdam-golm' ||
    selectedHouse === 'berlin-karow';
  const isCustom = selectedHouse === 'custom';

  // Demo houses: kick off the typewriter as soon as we land in autofilling.
  // Custom houses: ask the user to choose Auto vs Manual first.
  const [customMode, setCustomMode] = useState<CustomMode>('choosing');

  // Reset custom mode whenever the selectedHouse changes.
  const lastHouseRef = useRef(selectedHouse);
  useEffect(() => {
    if (lastHouseRef.current !== selectedHouse) {
      lastHouseRef.current = selectedHouse;
      setCustomMode('choosing');
    }
  }, [selectedHouse]);

  if (
    phase === 'idle' ||
    phase === 'agent-running' ||
    phase === 'interactive' ||
    phase === 'reviewing' ||
    phase === 'approved'
  ) {
    return null;
  }
  if (!selectedHouse) return null;

  // ─── Demo house: typewriter autofill, then Generate button ──────────────
  if (isDemoHouse) {
    return (
      <DemoAutoFill
        houseId={selectedHouse}
        onReady={(p) => {
          setProfile(p);
          setPhase('ready-to-design');
        }}
        onGenerate={() => setPhase('agent-running')}
        ready={!!profile && phase === 'ready-to-design'}
      />
    );
  }

  // ─── Custom address: ask the user, then either auto-fill or manual ──────
  if (!isCustom) return null;

  if (customMode === 'choosing') {
    return (
      <CustomChooser
        address={customAddress?.formatted ?? 'your address'}
        onAuto={() => {
          // Pull whatever profile /api/design pre-set for us (or the
          // heuristic if not yet there) and advance straight to ready.
          const current = useStore.getState().profile;
          if (current) {
            setPhase('ready-to-design');
          } else {
            // /api/design hasn't responded yet — wait for the design page
            // hook to seed the profile before flipping to ready.
            setPhase('autofilling');
          }
          setCustomMode('auto');
        }}
        onManual={() => setCustomMode('manual')}
      />
    );
  }

  if (customMode === 'auto') {
    return (
      <DemoAutoFill
        houseId={null}
        customAddress={customAddress?.formatted ?? ''}
        onReady={(p) => {
          setProfile(p);
          setPhase('ready-to-design');
        }}
        onGenerate={() => setPhase('agent-running')}
        ready={!!profile && phase === 'ready-to-design'}
      />
    );
  }

  // Manual — hand off to the full Reonic-style questionnaire.
  return (
    <CustomAddressForm
      address={customAddress?.formatted ?? ''}
      onGenerate={() => setPhase('agent-running')}
    />
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

interface AutoFillProps {
  houseId: HouseId | null;
  customAddress?: string;
  onReady: (p: CustomerProfile) => void;
  onGenerate: () => void;
  ready: boolean;
}

const FIELD_KEYS: (keyof CustomerProfile)[] = [
  'inhabitants',
  'annualConsumptionKwh',
  'houseSizeSqm',
  'heatingType',
  'hasEv',
];

function DemoAutoFill({
  houseId,
  customAddress,
  onReady,
  onGenerate,
  ready,
}: AutoFillProps) {
  const profile = useStore((s) => s.profile);
  // Demo houses: read from HOUSE_PROFILES. Custom-auto: read from store
  // (seeded by the /api/design call that fired on the design page).
  const target: CustomerProfile | null = houseId
    ? HOUSE_PROFILES[houseId]
    : profile;

  const [revealed, setRevealed] = useState(0);
  const fired = useRef(false);

  // Stash onReady in a ref so the typewriter effect doesn't re-fire each
  // time the parent re-renders with a fresh arrow-function reference (which
  // used to relaunch the whole autofill animation a second time).
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Typewriter: reveal one field every 600ms. As soon as the last field
  // appears, hand the profile back to the parent.
  useEffect(() => {
    if (!target) return;
    if (fired.current) return; // already completed for this mount/target
    const start = Date.now();
    const reset = setTimeout(() => setRevealed(0), 0);
    const interval = setInterval(() => {
      const next = Math.min(FIELD_KEYS.length, Math.floor((Date.now() - start) / 600) + 1);
      setRevealed(next);
      if (next >= FIELD_KEYS.length && !fired.current) {
        fired.current = true;
        onReadyRef.current(target);
        clearInterval(interval);
      }
    }, 80);
    return () => {
      clearTimeout(reset);
      clearInterval(interval);
    };
  }, [target]);

  const address =
    houseId !== null ? HOUSE_LOCATION[houseId] : customAddress ?? '';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl"
      >
        <div className="border-b border-zinc-100 px-7 py-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              Auto-filling profile
            </span>
          </div>
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">
            We&apos;re building your customer profile
          </h2>
          <p className="mt-1 truncate text-[12px] text-zinc-500" title={address}>
            {address || 'Working on your address…'}
          </p>
        </div>

        <ul className="space-y-2.5 px-7 py-5">
          {target ? (
            FIELD_KEYS.map((key, i) => {
              const visible = i < revealed;
              return (
                <motion.li
                  key={key}
                  initial={false}
                  animate={{ opacity: visible ? 1 : 0.18, x: visible ? 0 : -6 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="text-zinc-500">{labelFor(key)}</span>
                  <span className="font-mono font-semibold text-zinc-900">
                    {visible ? formatValue(target, key) : '…'}
                  </span>
                </motion.li>
              );
            })
          ) : (
            <li className="text-center text-[13px] text-zinc-500">
              Crunching k-NN matches…
            </li>
          )}
        </ul>

        <div className="border-t border-zinc-100 bg-zinc-50/60 px-7 py-4">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!ready}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-[14px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            {ready ? 'Generate design' : 'Filling…'}
            <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CustomChooser({
  address,
  onAuto,
  onManual,
}: {
  address: string;
  onAuto: () => void;
  onManual: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl"
      >
        <div className="px-8 py-7 text-center">
          <h2 className="text-[22px] font-bold tracking-tight text-zinc-900">
            How would you like to fill your profile?
          </h2>
          <p className="mt-1.5 text-[13px] text-zinc-500" title={address}>
            for <span className="font-medium text-zinc-700">{address}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 px-8 pb-7 sm:grid-cols-2">
          <button
            onClick={onAuto}
            className="group flex flex-col items-start gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-5 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
          >
            <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">
              RECOMMENDED
            </span>
            <span className="text-[16px] font-bold text-zinc-900">Auto-fill</span>
            <span className="text-[12.5px] leading-relaxed text-zinc-600">
              We infer plausible defaults for German residential and run k-NN
              against 1 620 deliveries.
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
              Continue
              <svg className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </button>

          <button
            onClick={onManual}
            className="group flex flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-left transition hover:border-zinc-400"
          >
            <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-700">
              5 SECTIONS
            </span>
            <span className="text-[16px] font-bold text-zinc-900">Fill manually</span>
            <span className="text-[12.5px] leading-relaxed text-zinc-600">
              Enter your consumption, heating, EV, and PV package preferences
              by hand.
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-zinc-700">
              Continue
              <svg className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function labelFor(key: keyof CustomerProfile): string {
  switch (key) {
    case 'annualConsumptionKwh': return 'Annual consumption';
    case 'inhabitants': return 'Inhabitants';
    case 'houseSizeSqm': return 'House size';
    case 'heatingType': return 'Heating';
    case 'hasEv': return 'Electric vehicle';
    case 'evAnnualKm': return 'EV km / year';
    case 'isJumelee': return 'Semi-detached';
  }
}

function formatValue(p: CustomerProfile, key: keyof CustomerProfile): string {
  switch (key) {
    case 'annualConsumptionKwh': return `${p.annualConsumptionKwh.toLocaleString()} kWh`;
    case 'inhabitants': return `${p.inhabitants}`;
    case 'houseSizeSqm': return `${p.houseSizeSqm} m²`;
    case 'heatingType': return p.heatingType;
    case 'hasEv': return p.hasEv ? `yes${p.evAnnualKm ? ` · ${p.evAnnualKm.toLocaleString()} km` : ''}` : 'no';
    case 'evAnnualKm': return p.evAnnualKm ? `${p.evAnnualKm.toLocaleString()} km` : '—';
    case 'isJumelee': return p.isJumelee ? 'yes' : 'no';
  }
}
