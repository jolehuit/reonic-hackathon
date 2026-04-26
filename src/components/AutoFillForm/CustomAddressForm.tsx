'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useStore,
  type BatteryPackage,
  type CalculateBy,
  type ChargerPackage,
  type Currency,
  type HeatingFamily,
  type PvPackage,
} from '@/lib/store';
import type { CustomerProfile, HeatingType } from '@/lib/types';
import { computeFinancials, ANNUAL_GENERATION_PER_KWP } from '@/lib/financials';

// Package → kWp size. Mirrors the typical Reonic offering: starter ≈ 5.5 kWp,
// comfort ≈ 6.6 kWp, premium ≈ 9.8 kWp. Used by ResultDashboard to feed the
// real `computeFinancials` engine instead of inventing percentages locally.
const PACKAGE_KWP: Record<PvPackage, number> = {
  starter: 5.5,
  comfort: 6.64,
  premium: 9.8,
};
// Same idea for batteries.
const BATTERY_KWH: Record<BatteryPackage, number> = {
  starter: 5,
  comfort: 8,
  premium: 12,
};

const CURRENCY_LABEL: Record<Currency, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};
const CURRENCY_UNIT: Record<Currency, string> = {
  EUR: 'ct/kWh',
  GBP: 'p/kWh',
  USD: 'ct/kWh',
};

// ───────────────────────────────────────────────────────────────────
// Root form: 5 stacked sections that match Reonic's onboarding flow.
// ───────────────────────────────────────────────────────────────────
export function CustomAddressForm({
  address,
  onGenerate,
}: {
  address: string;
  onGenerate: () => void;
}) {
  const m = useStore((s) => s.manualInputs);
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  const allSaved =
    m.saved.energy && m.saved.solar && m.saved.heating && m.saved.ev && m.saved.charger;

  const completedCount = Object.values(m.saved).filter(Boolean).length;
  const progressPct = Math.round((completedCount / 5) * 100);

  const showDashboard = !!m.selectedPackage;

  const submitProfile = () => {
    const heatingType: HeatingType =
      m.heatingFamily === 'renewable' ? 'heatpump' : 'gas';
    const profile: CustomerProfile = {
      annualConsumptionKwh: m.consumptionKwh,
      inhabitants: m.inhabitants,
      hasEv: !!m.hasEv,
      evAnnualKm: m.hasEv ? m.evAnnualKm : undefined,
      heatingType,
      houseSizeSqm: 140,
      isJumelee: false,
    };
    useStore.getState().setProfile(profile);
    onGenerate();
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-zinc-50">
      <div className="mx-auto flex min-h-full max-w-[1200px] gap-6 px-4 py-10">
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-[560px] flex-shrink-0 space-y-3"
    >
      {/* Header card with address */}
      <div className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
        <div className="px-7 pb-5 pt-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[20px] font-bold tracking-tight text-zinc-900">
              Tell us about your home
            </h2>
            <span className="flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
              </span>
              Custom address
            </span>
          </div>
          <p className="truncate text-[13px] text-zinc-500" title={address}>
            {address || 'Address unavailable'}
          </p>
          <div className="mt-4 flex items-center justify-between text-[12px]">
            <span className="font-medium text-zinc-500">
              {completedCount}/5 sections completed
            </span>
            <span className="font-mono font-semibold text-zinc-900">{progressPct}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
            <motion.div
              className="h-full bg-blue-500"
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>
      </div>

      <EnergyConsumptionSection />
      <SolarSection />
      <HeatingSection />
      <EvSection />
      <EvChargerSection />

      {allSaved && <OurOfferSection />}

      {/* Final CTA */}
      <div className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-4 px-7 py-5">
          <div className="flex items-center gap-2 text-[13px]">
            {allSaved ? (
              <>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                  <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="font-semibold text-zinc-900">Profile ready</span>
                <span className="text-zinc-400">· 100%</span>
              </>
            ) : (
              <span className="font-medium text-zinc-500">
                Complete every section to generate the design.
              </span>
            )}
          </div>
          <button
            onClick={() => {
              if (!allSaved) return;
              submitProfile();
            }}
            disabled={!allSaved}
            className="group flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            Generate design
            <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>

        {showDashboard && (
          <aside className="hidden flex-1 lg:block">
            <div className="sticky top-10">
              <ResultDashboard />
            </div>
          </aside>
        )}
      </div>

      <AnimatePresence>
        {enquiryOpen && (
          <EnquiryModal
            address={address}
            onClose={() => setEnquiryOpen(false)}
            onSubmit={() => {
              setEnquiryOpen(false);
              submitProfile();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Energy consumption — usage/cost toggle, kWh + people, price + currency,
// annual increase, time-of-use checkbox.
// ───────────────────────────────────────────────────────────────────
function EnergyConsumptionSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const save = useStore((s) => s.saveManualSection);
  const [editing, setEditing] = useState(!m.saved.energy);

  if (m.saved.energy && !editing) {
    return (
      <CollapsedSummary
        icon={<HomeIcon className="h-4 w-4 text-blue-600" />}
        label="Energy consumption"
        value={`${m.consumptionKwh.toLocaleString()} kWh`}
        onEdit={() => setEditing(true)}
      />
    );
  }

  return (
    <SectionCard
      icon={<HomeIcon className="h-4 w-4 text-blue-600" />}
      iconBg="bg-blue-50"
      title="Energy consumption"
      onSave={() => {
        save('energy');
        setEditing(false);
      }}
      saveDisabled={!m.consumptionKwh || !m.electricityPrice}
    >
      {/* Calculate by */}
      <Field label="Calculate by">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-50/50 p-1">
          {(['usage', 'cost'] as CalculateBy[]).map((opt) => {
            const active = m.calculateBy === opt;
            return (
              <button
                key={opt}
                onClick={() => update('calculateBy', opt)}
                className={`rounded-lg py-2 text-[13px] font-semibold capitalize transition ${
                  active
                    ? 'bg-white text-blue-600 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Residential consumption + people */}
      <Field label="Residential consumption">
        <div className="flex items-stretch gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min={0}
              value={m.consumptionKwh}
              onChange={(e) => update('consumptionKwh', Number(e.target.value))}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white pl-4 pr-20 text-[15px] font-semibold text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-medium text-zinc-400">
              kWh p.a.
            </span>
          </div>
          <PeopleSelector
            value={m.inhabitants}
            onChange={(v) => update('inhabitants', v)}
          />
        </div>
      </Field>

      {/* Price + currency + increase */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Electricity price">
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                step={0.1}
                value={m.electricityPrice}
                onChange={(e) => update('electricityPrice', Number(e.target.value))}
                className="h-12 w-full rounded-xl border border-zinc-200 bg-white pl-4 pr-16 text-[15px] font-semibold text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-zinc-400">
                {CURRENCY_UNIT[m.currency]}
              </span>
            </div>
            <CurrencySelector
              value={m.currency}
              onChange={(v) => update('currency', v)}
            />
          </div>
        </Field>
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              Increase
              <InfoDot />
            </span>
          }
        >
          <div className="relative">
            <select
              value={m.annualIncreasePct}
              onChange={(e) => update('annualIncreasePct', Number(e.target.value))}
              className="h-12 w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-4 pr-10 text-[14px] font-semibold text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((v) => (
                <option key={v} value={v}>
                  +{v}% p.a.
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </Field>
      </div>

      {/* Time of use */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 px-4 py-3">
        <div className="mb-1.5 text-[13px] font-semibold text-zinc-900">
          Prices based on time of use
        </div>
        <button
          onClick={() => update('timeOfUsePrices', !m.timeOfUsePrices)}
          className="flex items-center gap-2.5 text-left"
        >
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition ${
              m.timeOfUsePrices
                ? 'border-blue-600 bg-blue-600'
                : 'border-zinc-300 bg-white'
            }`}
          >
            {m.timeOfUsePrices && (
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className="inline-flex items-center gap-1 text-[13px] text-zinc-700">
            Use time of use windows &amp; prices
            <InfoDot />
          </span>
        </button>
      </div>
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────
// Existing solar — Yes/No.
// ───────────────────────────────────────────────────────────────────
function SolarSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const save = useStore((s) => s.saveManualSection);
  const [editing, setEditing] = useState(!m.saved.solar);

  if (m.saved.solar && !editing) {
    return (
      <CollapsedSummary
        icon={<SolarIcon className="h-4 w-4 text-blue-600" />}
        label="Existing solar system"
        value={m.hasSolar ? 'Yes' : 'No'}
        onEdit={() => setEditing(true)}
      />
    );
  }

  return (
    <SectionCard
      icon={<SolarIcon className="h-4 w-4 text-blue-600" />}
      iconBg="bg-blue-50"
      title="Do you already have a solar system?"
      onSave={() => {
        save('solar');
        setEditing(false);
      }}
      saveDisabled={m.hasSolar === null}
      saveHint={m.hasSolar === null ? 'Please make a selection' : undefined}
    >
      <YesNoChoice
        value={m.hasSolar}
        onChange={(v) => update('hasSolar', v)}
      />
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────
// Heating — Renewable / Conventional.
// ───────────────────────────────────────────────────────────────────
function HeatingSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const save = useStore((s) => s.saveManualSection);
  const [editing, setEditing] = useState(!m.saved.heating);

  if (m.saved.heating && !editing) {
    return (
      <CollapsedSummary
        icon={<WavesIcon className="h-4 w-4 text-emerald-600" />}
        label="Heating"
        value={m.heatingFamily === 'renewable' ? 'Renewable' : m.heatingFamily === 'conventional' ? 'Conventional' : '—'}
        onEdit={() => setEditing(true)}
      />
    );
  }

  const options: Array<{ id: HeatingFamily; title: string; sub: string }> = [
    { id: 'renewable', title: 'Renewable', sub: 'Heat pump, pellet heating, infrared' },
    { id: 'conventional', title: 'Conventional', sub: 'Oil heating, gas heating' },
  ];

  return (
    <SectionCard
      icon={<WavesIcon className="h-4 w-4 text-emerald-600" />}
      iconBg="bg-emerald-50"
      title="How do you currently heat?"
      onSave={() => {
        save('heating');
        setEditing(false);
      }}
      saveDisabled={!m.heatingFamily}
      onSkip={() => {
        save('heating');
        setEditing(false);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const active = m.heatingFamily === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => update('heatingFamily', opt.id)}
              className={`rounded-xl border-2 px-4 py-4 text-center transition ${
                active
                  ? 'border-emerald-600 bg-emerald-50/30'
                  : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div className={`text-[15px] font-bold ${active ? 'text-emerald-700' : 'text-zinc-900'}`}>
                {opt.title}
              </div>
              <div className="mt-0.5 text-[12px] text-zinc-500">{opt.sub}</div>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────
// Electric car — Yes/No, model picker, annual mileage.
// ───────────────────────────────────────────────────────────────────
function EvSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const save = useStore((s) => s.saveManualSection);
  const [editing, setEditing] = useState(!m.saved.ev);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (m.saved.ev && !editing) {
    return (
      <CollapsedSummary
        icon={<EvCarIcon className="h-4 w-4 text-emerald-600" />}
        label="Electric car"
        value={
          m.hasEv
            ? `${m.evModel ?? 'Yes'}${m.evAnnualKm ? ` · ${m.evAnnualKm.toLocaleString()} km` : ''}`
            : 'No'
        }
        onEdit={() => setEditing(true)}
      />
    );
  }

  const isYes = m.hasEv === true;

  return (
    <SectionCard
      icon={<EvCarIcon className="h-4 w-4 text-emerald-600" />}
      iconBg="bg-emerald-50"
      title="Do you already own an electric car?"
      onSave={() => {
        save('ev');
        setEditing(false);
      }}
      saveDisabled={m.hasEv === null || (isYes && !m.evAnnualKm)}
    >
      <YesNoChoice
        value={m.hasEv}
        onChange={(v) => update('hasEv', v)}
        accent="emerald"
      />

      <AnimatePresence initial={false}>
        {isYes && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 overflow-hidden"
          >
            {/* Selected model row */}
            <div className="mt-1 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
              <div className="flex h-10 w-14 flex-shrink-0 items-center justify-center rounded-md bg-zinc-900">
                <EvCarIcon className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 truncate">
                <div className="truncate text-[14px] font-bold text-zinc-900">
                  {m.evModel ?? 'No model selected'}
                </div>
              </div>
              <button
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 hover:text-emerald-800"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                {m.evModel ? 'Change model' : 'Select model'}
              </button>
            </div>

            {/* Annual mileage */}
            <Field label="Annual mileage">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={m.evAnnualKm ?? ''}
                  onChange={(e) =>
                    update('evAnnualKm', e.target.value ? Number(e.target.value) : undefined)
                  }
                  className="h-12 w-full rounded-xl border border-zinc-200 bg-white pl-4 pr-12 text-[15px] font-semibold text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-medium text-zinc-400">
                  km
                </span>
              </div>
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pickerOpen && (
          <EvModelPicker
            onClose={() => setPickerOpen(false)}
            onSelect={(name) => {
              update('evModel', name);
              setPickerOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────
// EV charger — Yes/No.
// ───────────────────────────────────────────────────────────────────
function EvChargerSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const save = useStore((s) => s.saveManualSection);
  const [editing, setEditing] = useState(!m.saved.charger);

  if (m.saved.charger && !editing) {
    return (
      <CollapsedSummary
        icon={<ChargerIcon className="h-4 w-4 text-emerald-600" />}
        label="EV Charger"
        value={m.hasEvCharger ? 'Yes' : 'No'}
        onEdit={() => setEditing(true)}
      />
    );
  }

  return (
    <SectionCard
      icon={<ChargerIcon className="h-4 w-4 text-emerald-600" />}
      iconBg="bg-emerald-50"
      title="Do you already have an EV Charger?"
      onSave={() => {
        save('charger');
        setEditing(false);
      }}
      saveDisabled={m.hasEvCharger === null}
      saveHint={m.hasEvCharger === null ? 'Please make a selection' : undefined}
    >
      <YesNoChoice
        value={m.hasEvCharger}
        onChange={(v) => update('hasEvCharger', v)}
        accent="emerald"
      />
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Reusable building blocks (Reonic style)
// ═══════════════════════════════════════════════════════════════════

function SectionCard({
  icon,
  iconBg,
  title,
  children,
  onSave,
  onSkip,
  saveDisabled,
  saveHint,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  onSkip?: () => void;
  saveDisabled?: boolean;
  saveHint?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      <div className="px-7 pb-5 pt-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className={`flex h-7 w-7 items-center justify-center rounded-md ${iconBg}`}>
            {icon}
          </span>
          <h3 className="text-[16px] font-bold tracking-tight text-zinc-900">{title}</h3>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-7 py-3.5">
        <button className="text-[12.5px] text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline">
          Why is that important?
        </button>
        <div className="flex items-center gap-3">
          {saveHint && (
            <span className="text-[12.5px] font-semibold text-zinc-700">{saveHint}</span>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-1.5 text-[13px] font-semibold text-zinc-700 transition hover:border-zinc-300"
            >
              Skip
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saveDisabled}
            className={`flex items-center gap-1.5 rounded-lg border-2 px-4 py-1.5 text-[13px] font-bold transition ${
              saveDisabled
                ? 'cursor-not-allowed border-zinc-200 bg-white text-zinc-300'
                : 'border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            Save
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function CollapsedSummary({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white px-5 py-3.5 shadow-[0_4px_14px_-8px_rgba(0,0,0,0.12)]"
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-50">
        {icon}
      </span>
      <div className="flex-1 truncate">
        <span className="text-[14px] font-bold text-zinc-900">{label}: </span>
        <span className="text-[14px] font-semibold text-zinc-700">{value}</span>
      </div>
      <button
        onClick={onEdit}
        className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Edit"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </motion.div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12.5px] font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function YesNoChoice({
  value,
  onChange,
  accent = 'blue',
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  accent?: 'blue' | 'emerald';
}) {
  const accentClass =
    accent === 'emerald'
      ? 'border-emerald-600 bg-emerald-50/30 text-emerald-700'
      : 'border-blue-600 bg-blue-50/30 text-blue-700';
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { id: true, label: 'Yes' },
        { id: false, label: 'No' },
      ].map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.id)}
            className={`rounded-xl border-2 py-4 text-center text-[15px] font-bold transition ${
              active ? accentClass : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PeopleSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const options = [1, 2, 3, 4];
  return (
    <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {options.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex w-10 items-center justify-center transition ${
              active ? 'bg-blue-50' : 'bg-white hover:bg-zinc-50'
            }`}
            aria-label={`${n} ${n === 1 ? 'person' : 'people'}`}
          >
            <PeopleIcon count={n} active={active} />
          </button>
        );
      })}
    </div>
  );
}

function CurrencySelector({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (v: Currency) => void;
}) {
  const options: Currency[] = ['EUR', 'GBP', 'USD'];
  return (
    <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {options.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`flex w-10 items-center justify-center text-[15px] font-bold transition ${
              active ? 'bg-blue-50 text-blue-700' : 'text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {CURRENCY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

function EvModelPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('All brands');
  const cars = useMemo(
    () => [
      { name: 'Elaris · Beo', year: 2023, hp: 204, range: '489–400 km', battery: '81 kWh', consumption: '19.8–19.3 kWh/100km' },
      { name: 'Tesla · Model Y', year: 2024, hp: 299, range: '533 km', battery: '75 kWh', consumption: '15.7 kWh/100km' },
      { name: 'VW · ID.4', year: 2024, hp: 204, range: '517 km', battery: '77 kWh', consumption: '17.0 kWh/100km' },
      { name: 'BMW · i4', year: 2024, hp: 340, range: '590 km', battery: '83.9 kWh', consumption: '16.1 kWh/100km' },
      { name: 'Renault · Megane E-Tech', year: 2023, hp: 220, range: '450 km', battery: '60 kWh', consumption: '16.1 kWh/100km' },
    ],
    [],
  );
  const filtered = cars.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/40 px-4 py-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-7 pt-6">
          <h3 className="text-[22px] font-bold tracking-tight text-zinc-900">
            Select your existing electric car
          </h3>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[14px] font-semibold text-zinc-500 hover:text-zinc-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>
        </div>
        <div className="flex items-center gap-3 px-7 pb-3 pt-4">
          <div className="relative">
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="h-11 appearance-none rounded-xl border border-zinc-200 bg-white pl-4 pr-10 text-[14px] font-medium text-zinc-700 outline-none focus:border-zinc-300"
            >
              <option>All brands</option>
              <option>Tesla</option>
              <option>VW</option>
              <option>BMW</option>
              <option>Renault</option>
              <option>Elaris</option>
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <div className="relative flex-1">
            <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-11 pr-4 text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
          </div>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-7 pb-7">
          {filtered.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-900">
                <EvCarIcon className="h-8 w-8 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-bold text-zinc-900">{c.name}</div>
                <div className="mt-0.5 text-[12px] text-zinc-500">
                  <span className="font-semibold text-zinc-900">{c.year}</span> First registration{'  '}
                  <span className="font-semibold text-zinc-900">{c.hp} hp</span> Performance{'  '}
                  <span className="font-semibold text-zinc-900">{c.range}</span> Range
                </div>
                <div className="text-[12px] text-zinc-500">
                  <span className="font-semibold text-zinc-900">{c.consumption}</span> Consumption{'  '}
                  <span className="font-semibold text-zinc-900">{c.battery}</span> Battery
                </div>
              </div>
              <button
                onClick={() => onSelect(c.name)}
                className="flex items-center gap-1.5 rounded-lg border-2 border-emerald-600 bg-white px-4 py-2 text-[13px] font-bold text-emerald-700 transition hover:bg-emerald-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Select
              </button>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Our offer — split into 2 phases:
//   1. Pre-selection: Solar card (full roof analysis) + EV Charger teaser
//   2. Post-selection: PV summary + battery slot + EV charger slot
// ───────────────────────────────────────────────────────────────────
function OurOfferSection() {
  const m = useStore((s) => s.manualInputs);
  const update = useStore((s) => s.updateManualInput);
  const [pvOpen, setPvOpen] = useState(false);
  const [batteryOpen, setBatteryOpen] = useState(false);
  const [chargerOpen, setChargerOpen] = useState(false);

  const evCarLabel = m.evModel?.split('·').pop()?.trim() ?? 'EV';
  const hasPv = !!m.selectedPackage;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-3"
    >
      <h3 className="text-[22px] font-bold tracking-tight text-zinc-900">Our offer</h3>

      {hasPv ? (
        <PvSummaryCard
          pkg={m.selectedPackage as PvPackage}
          onChange={() => setPvOpen(true)}
          onRemove={() => update('selectedPackage', null)}
        />
      ) : (
        <SolarOfferCard onClick={() => setPvOpen(true)} />
      )}

      {/* Battery slot — appears once PV is picked */}
      {hasPv && (
        <BatterySlotCard
          selected={m.selectedBattery}
          onClick={() => setBatteryOpen(true)}
          onRemove={() => update('selectedBattery', null)}
        />
      )}

      {/* EV Charger slot — appears once PV picked */}
      {hasPv && (
        <EvChargerSlotCard
          selected={m.selectedCharger}
          carLabel={m.hasEv ? evCarLabel : 'future EV'}
          onClick={() => setChargerOpen(true)}
          onRemove={() => update('selectedCharger', null)}
        />
      )}

      <AnimatePresence>
        {pvOpen && (
          <PackageSelector
            selected={m.selectedPackage}
            onSelect={(pkg) => update('selectedPackage', pkg)}
            onClose={() => setPvOpen(false)}
          />
        )}
        {batteryOpen && (
          <BatterySelector
            selected={m.selectedBattery}
            onSelect={(pkg) => update('selectedBattery', pkg)}
            onClose={() => setBatteryOpen(false)}
          />
        )}
        {chargerOpen && (
          <EvChargerSelector
            selected={m.selectedCharger}
            onSelect={(pkg) => update('selectedCharger', pkg)}
            onClose={() => setChargerOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const PV_INFO: Record<PvPackage, { name: string; kwPeak: string; price: number }> = {
  starter: { name: 'PV Starter', kwPeak: '5.0 kWPeak', price: 6000 },
  comfort: { name: 'PV Comfort', kwPeak: '8.5 kWPeak', price: 14000 },
  premium: { name: 'PV Premium', kwPeak: '12.0 kWPeak', price: 18000 },
};

function PvSummaryCard({
  pkg,
  onChange,
  onRemove,
}: {
  pkg: PvPackage;
  onChange: () => void;
  onRemove: () => void;
}) {
  const info = PV_INFO[pkg];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_4px_14px_-8px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-center gap-4 px-6 py-5">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600">
          <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <div className="flex-1">
          <div className="text-[17px] font-bold tracking-tight text-zinc-900">{info.name}</div>
          <div className="text-[12.5px] text-zinc-500">
            {info.kwPeak} · €{info.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <button
          onClick={onChange}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-700 hover:text-zinc-900"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Change
        </button>
        <button
          onClick={onRemove}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-500 hover:text-zinc-800"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Remove
        </button>
      </div>
    </motion.div>
  );
}

function SolarOfferCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group block w-full overflow-hidden rounded-3xl border border-zinc-200/70 bg-white text-left shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] transition hover:border-zinc-300"
    >
      <div className="flex items-start gap-4 px-6 pb-5 pt-6">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-emerald-500" />
        <div className="flex-1">
          <div className="text-[18px] font-bold tracking-tight text-zinc-900">
            Find the right solar system for your roof
          </div>
          <div className="mt-1 text-[13px] text-zinc-500">
            Having your own solar system saves costs and protects the environment
          </div>
        </div>
        <svg className="mt-1 h-5 w-5 flex-shrink-0 text-zinc-300 transition group-hover:text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      <div className="mx-6 border-t border-zinc-100" />

      <div className="px-6 py-5">
        <div className="mb-3 text-[12.5px] font-medium text-zinc-500">Your roof</div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/70 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-[13px] font-bold text-zinc-900">
                Well suited (with restrictions)
              </span>
            </div>
            <p className="mt-3 text-[13px] text-zinc-600">
              Your roof can support a maximum of approx. <strong className="text-zinc-900">12 modules</strong>.
            </p>
          </div>
          <div>
            <div className="text-[28px] font-bold leading-none tracking-tight text-zinc-900">
              85 m² <span className="text-[14px] font-medium text-zinc-500">roof area</span>
            </div>
            <p className="mt-3 text-[13px] text-zinc-600">
              Your roof is pitched at around <strong className="text-zinc-900">55°</strong> and has a west side and south side.
            </p>
          </div>
        </div>
        <p className="mt-4 flex items-start gap-1.5 text-[12px] text-zinc-400">
          <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" />
          </svg>
          We automatically determine these values for your roof using AI algorithms. After you have submitted an inquiry, we will of course check your roof in detail.
        </p>
      </div>
    </button>
  );
}

const BATTERY_INFO: Record<BatteryPackage, { name: string; price: number }> = {
  starter: { name: 'Battery Starter', price: 4000 },
  comfort: { name: 'Battery Comfort', price: 6500 },
  premium: { name: 'Battery Premium', price: 15000 },
};

function BatterySlotCard({
  selected,
  onClick,
  onRemove,
}: {
  selected: BatteryPackage | null;
  onClick: () => void;
  onRemove: () => void;
}) {
  if (selected) {
    const info = BATTERY_INFO[selected];
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_4px_14px_-8px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-center gap-4 px-6 py-5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600">
            <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex-1">
            <div className="text-[17px] font-bold tracking-tight text-zinc-900">{info.name}</div>
            <div className="text-[12.5px] text-zinc-500">
              €{info.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <button onClick={onClick} className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-700 hover:text-zinc-900">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Change
          </button>
          <button onClick={onRemove} className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-500 hover:text-zinc-800">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Remove
          </button>
        </div>
      </motion.div>
    );
  }
  return (
    <button
      onClick={onClick}
      className="group block w-full rounded-3xl border border-zinc-200/70 bg-zinc-100/60 text-left transition hover:border-zinc-300 hover:bg-zinc-100"
    >
      <div className="flex items-start gap-4 px-6 py-6">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-zinc-300" />
        <div className="flex-1">
          <div className="text-[18px] font-bold tracking-tight text-zinc-900">
            Add a power storage unit
          </div>
          <div className="mt-1 text-[13px] text-zinc-500">
            With a power storage system, you are independent of the power grid even at times when solar radiation is low
          </div>
        </div>
        <svg className="mt-1 h-5 w-5 flex-shrink-0 text-zinc-300 transition group-hover:text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}

const CHARGER_INFO: Record<ChargerPackage, { name: string; price: number }> = {
  comfort: { name: 'EV Charger Comfort', price: 2000 },
};

function EvChargerSlotCard({
  selected,
  carLabel,
  onClick,
  onRemove,
}: {
  selected: ChargerPackage | null;
  carLabel: string;
  onClick: () => void;
  onRemove: () => void;
}) {
  if (selected) {
    const info = CHARGER_INFO[selected];
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_4px_14px_-8px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-center gap-4 px-6 py-5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600">
            <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex-1">
            <div className="text-[17px] font-bold tracking-tight text-zinc-900">{info.name}</div>
            <div className="text-[12.5px] text-zinc-500">
              €{info.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <button onClick={onClick} className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-700 hover:text-zinc-900">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Change
          </button>
          <button onClick={onRemove} className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-500 hover:text-zinc-800">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Remove
          </button>
        </div>
      </motion.div>
    );
  }
  return (
    <button
      onClick={onClick}
      className="group block w-full rounded-3xl border border-zinc-200/70 bg-white text-left shadow-[0_4px_14px_-8px_rgba(0,0,0,0.12)] transition hover:border-zinc-300"
    >
      <div className="flex items-start gap-4 px-6 py-6">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-zinc-300" />
        <div className="flex-1">
          <div className="text-[18px] font-bold tracking-tight text-zinc-900">
            Find the right EV Charger for your {carLabel}
          </div>
          <div className="mt-1 text-[13px] text-zinc-500">
            With an EV Charger, you can use the electricity from your solar system to charge your electric car without any detours
          </div>
        </div>
        <svg className="mt-1 h-5 w-5 flex-shrink-0 text-zinc-300 transition group-hover:text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}

function BatterySelector({
  selected,
  onSelect,
  onClose,
}: {
  selected: BatteryPackage | null;
  onSelect: (pkg: BatteryPackage) => void;
  onClose: () => void;
}) {
  const packages: Array<{
    id: BatteryPackage;
    title: string;
    illustration: 'premium' | 'comfort' | 'starter';
    description: string;
    priceLabel: string;
    price: number;
  }> = [
    {
      id: 'premium',
      title: 'Battery Premium',
      illustration: 'premium',
      description:
        'Experience the full potential of home energy storage with our Battery Premium Package — our most powerful solution.\n\nThis package features top-tier lithium storage modules, high discharge power, and grid-ready backup capability, keeping your home running even during outages.\nCombined with cutting-edge energy intelligence, ultra-fast response times, and expandable capacity, it delivers unmatched comfort and peace of mind.',
      priceLabel: 'Purchase from',
      price: 15000,
    },
    {
      id: 'comfort',
      title: 'Battery Comfort',
      illustration: 'comfort',
      description:
        'Unlock more flexibility with the Battery Comfort Package, designed for households that want longer backup times and more control over their energy use.\n\nEquipped with a high-capacity battery module, smart load management, and expanded discharge power, this package delivers strong performance during evening peaks and cloudy days.\nWith advanced monitoring and upgrade-ready design, it’s a future-proof solution that grows with your home’s energy needs.',
      priceLabel: 'Purchase from',
      price: 6500,
    },
    {
      id: 'starter',
      title: 'Battery Starter',
      illustration: 'starter',
      description:
        'Take the first step toward true energy independence with our Battery Starter Package.\nThis compact system stores your excess solar power and makes it available exactly when you need it — day or night.\n\nWith reliable entry-level storage capacity, an intelligent battery management system, and seamless integration into your existing PV setup, this package is perfect for homeowners looking to dramatically reduce grid reliance without breaking the bank.',
      priceLabel: 'Purchase from',
      price: 4000,
    },
  ];

  return (
    <ModalShell title="Our offer" onClose={onClose} columns={3}>
      {packages.map((p, idx) => (
        <PackageCard
          key={p.id}
          index={idx}
          total={packages.length}
          isSelected={selected === p.id}
          title={p.title}
          description={p.description}
          priceLabel={p.priceLabel}
          price={p.price}
          onSelect={() => onSelect(p.id)}
          illustration={<BatteryIllustration variant={p.illustration} />}
        />
      ))}
    </ModalShell>
  );
}

function EvChargerSelector({
  selected,
  onSelect,
  onClose,
}: {
  selected: ChargerPackage | null;
  onSelect: (pkg: ChargerPackage) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="Our offer" onClose={onClose} columns={1}>
      <PackageCard
        index={0}
        total={1}
        isSelected={selected === 'comfort'}
        title="EV Charger Comfort"
        description={
          'Upgrade your home charging with the Wallbox Comfort Package, featuring dynamic load management, app-controlled charging, and stronger charging performance for faster everyday use.\n\nPerfect for multi-car households or drivers who want more control over energy consumption, this package offers a smooth, smart, and future-ready charging experience.'
        }
        priceLabel="Purchase from"
        price={2000}
        onSelect={() => onSelect('comfort')}
        illustration={<ChargerIllustration />}
      />
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  columns,
  children,
}: {
  title: string;
  onClose: () => void;
  columns: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 px-4 py-10 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full overflow-hidden rounded-3xl bg-white shadow-2xl ${
          columns === 1 ? 'max-w-md' : 'max-w-6xl'
        }`}
      >
        <div className="flex items-center justify-between px-8 pt-7">
          <h3 className="text-[26px] font-bold tracking-tight text-zinc-900">{title}</h3>
          <button onClick={onClose} className="flex items-center gap-1.5 text-[14px] font-semibold text-zinc-500 hover:text-zinc-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>
        </div>
        <div
          className={`grid gap-5 p-7 ${
            columns === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'
          }`}
        >
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

function PackageCard({
  index,
  total,
  isSelected,
  title,
  description,
  priceLabel,
  price,
  onSelect,
  illustration,
  recommended,
  contents,
}: {
  index: number;
  total: number;
  isSelected: boolean;
  title: string;
  description: string;
  priceLabel: string;
  price: number;
  onSelect: () => void;
  illustration: React.ReactNode;
  recommended?: boolean;
  contents?: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col overflow-hidden rounded-2xl border-2 bg-white text-left transition ${
        isSelected
          ? 'border-emerald-600 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.45)]'
          : 'border-zinc-200 hover:border-zinc-300'
      }`}
    >
      <div className="relative h-44 overflow-hidden">
        {illustration}
        {recommended && (
          <div className="absolute left-0 top-6 -rotate-45 origin-top-left -translate-x-10 bg-blue-600 px-12 py-1 text-[11px] font-bold tracking-wider text-white shadow-md">
            Recommended
          </div>
        )}
        <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-[12px] font-bold text-zinc-900 shadow-md">
          {index + 1}/<span className="text-zinc-500">{total}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h4 className="text-[22px] font-bold tracking-tight text-zinc-900">{title}</h4>
        <div>
          <div className="text-[13px] font-bold text-zinc-900">Description</div>
          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-600">
            {description}
          </p>
        </div>
        {contents && (
          <div>
            <div className="text-[13px] font-bold text-zinc-900">Contents</div>
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-600">
              {contents}
            </p>
          </div>
        )}
        <div className="mt-auto flex items-center gap-3 rounded-xl bg-zinc-100/70 p-3.5">
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
              isSelected ? 'border-emerald-600 bg-emerald-600' : 'border-zinc-300 bg-white'
            }`}
          >
            {isSelected && (
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <div className="flex-1">
            <div className="text-[14px] font-bold text-zinc-900">{priceLabel}</div>
            <div className="text-[11px] text-zinc-500">one time</div>
          </div>
          <div className="text-right">
            <div className="text-[16px] font-bold text-zinc-900">
              {price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              <span className="ml-0.5 text-[12px] font-medium text-zinc-500">€</span>
            </div>
            <div className="text-[11px] text-zinc-500">incl. 0.00 VAT</div>
          </div>
        </div>
      </div>
    </button>
  );
}

function BatteryIllustration({ variant }: { variant: 'starter' | 'comfort' | 'premium' }) {
  const palette =
    variant === 'starter'
      ? { wall: '#e7d6c0', floor: '#1f2a1c', cabinet: '#f3f3f3' }
      : variant === 'comfort'
      ? { wall: '#dcd0bc', floor: '#2d2419', cabinet: '#cccccc' }
      : { wall: '#bfd1de', floor: '#1d2330', cabinet: '#dee3eb' };
  const count = variant === 'comfort' ? 3 : variant === 'premium' ? 4 : 1;
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="180" fill={palette.wall} />
      <rect y="130" width="320" height="50" fill={palette.floor} />
      {Array.from({ length: count }).map((_, i) => {
        const x = 40 + i * 60;
        return (
          <g key={i}>
            <rect x={x} y={50} width="44" height="80" rx="3" fill={palette.cabinet} stroke="#999" strokeWidth="1" />
            <rect x={x + 6} y={60} width="32" height="6" rx="1" fill="#3aa0ff" opacity="0.7" />
            <rect x={x + 6} y={72} width="32" height="3" rx="1" fill="#999" />
            <rect x={x + 6} y={80} width="20" height="3" rx="1" fill="#999" />
          </g>
        );
      })}
      <rect x={250} y={120} width={4} height={10} fill="#666" />
    </svg>
  );
}

function ChargerIllustration() {
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="180" fill="#e7e7e2" />
      <rect y="130" width="320" height="50" fill="#cfcfca" />
      {/* Charger box */}
      <rect x="40" y="60" width="40" height="60" rx="3" fill="#fafafa" stroke="#999" />
      <rect x="48" y="68" width="24" height="6" rx="1" fill="#3aa0ff" />
      <rect x="48" y="80" width="24" height="20" rx="1" fill="#222" />
      <path d="M55 105 Q55 130 70 130 L120 135" stroke="#222" strokeWidth="3" fill="none" />
      {/* Car */}
      <g transform="translate(160 90)">
        <ellipse cx="60" cy="38" rx="58" ry="9" fill="#000" opacity="0.15" />
        <path d="M5 35 L20 18 Q25 12 35 12 L85 12 Q95 12 105 22 L120 35 Z" fill="#fafafa" stroke="#999" />
        <rect x="5" y="32" width="115" height="8" rx="3" fill="#fafafa" stroke="#999" />
        <circle cx="30" cy="42" r="7" fill="#222" />
        <circle cx="95" cy="42" r="7" fill="#222" />
      </g>
    </svg>
  );
}

function PackageSelector({
  selected,
  onSelect,
  onClose,
}: {
  selected: PvPackage | null;
  onSelect: (pkg: PvPackage) => void;
  onClose: () => void;
}) {
  const packages: Array<{
    id: PvPackage;
    title: string;
    recommended?: boolean;
    illustration: React.ReactNode;
    description: string;
    contents?: string;
    priceLabel: string;
    priceEur: number;
  }> = [
    {
      id: 'starter',
      title: 'PV Starter',
      illustration: <PackageIllustration variant="starter" />,
      description:
        'Step into the world of clean, affordable energy with our PV Starter Package — the perfect entry into solar power for homeowners who want maximum impact with minimum hassle.\n\nOur bundle includes high-efficiency solar modules, a smart inverter, and a premium mounting system, all professionally installed by our certified technicians. You get reliable performance, built-in monitoring, and an installation process that’s smooth from start to finish.',
      priceLabel: 'Purchase',
      priceEur: 6000,
    },
    {
      id: 'comfort',
      title: 'PV Comfort',
      recommended: true,
      illustration: <PackageIllustration variant="comfort" />,
      description: 'PV Comfort',
      contents:
        'Upgrade your solar experience with our PV Comfort Package — the ideal choice for households that want stronger performance and even greater independence.\n\nThis package comes with next-generation high-output modules, an intelligent hybrid inverter, and enhanced roof mounting for better efficiency and durability.',
      priceLabel: 'Purchase from',
      priceEur: 14000,
    },
    {
      id: 'premium',
      title: 'PV Premium',
      illustration: <PackageIllustration variant="premium" />,
      description:
        'For those who want the full solar experience, the PV Premium Package delivers top-tier performance and complete self-sufficiency.\n\nFeaturing ultra-high-efficiency modules, a hybrid inverter, and a state-of-the-art battery storage system, this package transforms your home into an energy powerhouse — day and night.',
      priceLabel: 'Purchase from',
      priceEur: 18000,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 px-4 py-10 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-8 pt-7">
          <h3 className="text-[26px] font-bold tracking-tight text-zinc-900">Our offer</h3>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[14px] font-semibold text-zinc-500 hover:text-zinc-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 p-7 md:grid-cols-3">
          {packages.map((p, idx) => {
            const isSelected = selected === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`flex flex-col overflow-hidden rounded-2xl border-2 bg-white text-left transition ${
                  isSelected
                    ? 'border-emerald-600 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.45)]'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="relative h-44 overflow-hidden">
                  {p.illustration}
                  {p.recommended && (
                    <div className="absolute left-0 top-6 -rotate-45 origin-top-left -translate-x-10 bg-blue-600 px-12 py-1 text-[11px] font-bold tracking-wider text-white shadow-md">
                      Recommended
                    </div>
                  )}
                  <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-[12px] font-bold text-zinc-900 shadow-md">
                    {idx + 1}/<span className="text-zinc-500">3</span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <h4 className="text-[22px] font-bold tracking-tight text-zinc-900">{p.title}</h4>
                  <div>
                    <div className="text-[13px] font-bold text-zinc-900">Description</div>
                    <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-600">
                      {p.description}
                    </p>
                  </div>
                  {p.contents && (
                    <div>
                      <div className="text-[13px] font-bold text-zinc-900">Contents</div>
                      <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-600">
                        {p.contents}
                      </p>
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-3 rounded-xl bg-zinc-100/70 p-3.5">
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? 'border-emerald-600 bg-emerald-600' : 'border-zinc-300 bg-white'
                      }`}
                    >
                      {isSelected && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <div className="flex-1">
                      <div className="text-[14px] font-bold text-zinc-900">{p.priceLabel}</div>
                      <div className="text-[11px] text-zinc-500">one time</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[16px] font-bold text-zinc-900">
                        {p.priceEur.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        <span className="ml-0.5 text-[12px] font-medium text-zinc-500">€</span>
                      </div>
                      <div className="text-[11px] text-zinc-500">incl. 0.00 VAT</div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

function PackageIllustration({ variant }: { variant: PvPackage }) {
  const palette =
    variant === 'starter'
      ? { sky: '#cfe6ff', roof: '#c25a3a', panel: '#1f2a44', glow: '#7fb8ff' }
      : variant === 'comfort'
      ? { sky: '#1d6fd8', roof: '#23314c', panel: '#0e1626', glow: '#3aa0ff' }
      : { sky: '#1a2236', roof: '#3b2a1c', panel: '#0a0d18', glow: '#6e8bff' };
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`sky-${variant}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={palette.sky} />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#sky-${variant})`} />
      {/* Sun */}
      <circle cx="260" cy="42" r="22" fill={palette.glow} opacity="0.55" />
      <circle cx="260" cy="42" r="12" fill="#fff" opacity="0.85" />
      {/* Roof */}
      <polygon points="0,180 0,118 160,46 320,118 320,180" fill={palette.roof} />
      {/* Panels grid */}
      {Array.from({ length: variant === 'starter' ? 8 : variant === 'comfort' ? 14 : 18 }).map(
        (_, i) => {
          const cols = variant === 'starter' ? 4 : variant === 'comfort' ? 7 : 9;
          const r = Math.floor(i / cols);
          const c = i % cols;
          const x = 60 + c * 28;
          const y = 90 + r * 18;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width="24"
              height="14"
              rx="1.5"
              fill={palette.panel}
              stroke="#0a0d18"
              strokeWidth="0.5"
            />
          );
        },
      )}
      {/* Window left */}
      <rect x="20" y="110" width="32" height="40" fill="#1d2436" rx="2" />
      <line x1="36" y1="110" x2="36" y2="150" stroke="#fff" strokeOpacity="0.2" />
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────
// Enquiry contact modal — opens when user submits with a PV package
// ───────────────────────────────────────────────────────────────────
function parseFormattedAddress(formatted: string) {
  const parts = formatted
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Drop trailing country if it has no digits and isn't postal
  const last = parts[parts.length - 1];
  if (parts.length > 2 && last && !/\d/.test(last)) parts.pop();
  const street = parts[0] ?? '';
  const postalCity = parts[1] ?? '';
  let streetName = street;
  let houseNum = '';
  const trailing = street.match(/^(.+?)\s+(\d+\s?[a-zA-Z]?)$/);
  const leading = street.match(/^(\d+\s?[a-zA-Z]?)\s+(.+)$/);
  if (trailing) {
    streetName = trailing[1];
    houseNum = trailing[2];
  } else if (leading) {
    houseNum = leading[1];
    streetName = leading[2];
  }
  const pc = postalCity.match(/^(\S+)\s+(.+)$/);
  const postal = pc ? pc[1] : '';
  const city = pc ? pc[2] : postalCity;
  return { streetName, houseNum, postal, city };
}

function EnquiryModal({
  address,
  onClose,
  onSubmit,
}: {
  address: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const parsed = useMemo(() => parseFormattedAddress(address), [address]);
  const [salutation, setSalutation] = useState('');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [reachability, setReachability] = useState('');
  const [street, setStreet] = useState(parsed.streetName);
  const [houseNum, setHouseNum] = useState(parsed.houseNum);
  const [postal, setPostal] = useState(parsed.postal);
  const [city, setCity] = useState(parsed.city);
  const [message, setMessage] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSend =
    firstName.trim() &&
    surname.trim() &&
    emailValid &&
    phone.trim() &&
    street.trim() &&
    houseNum.trim() &&
    postal.trim() &&
    city.trim() &&
    isOwner &&
    acceptedPolicy;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-zinc-900/50 p-4 backdrop-blur-sm sm:p-8"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-zinc-100 px-8 pb-5 pt-7">
          <h2 className="text-[26px] font-extrabold tracking-tight text-zinc-900">
            Would you like to receive an offer?
          </h2>
          <p className="mt-1 text-[13.5px] text-zinc-500">
            Your enquiry will be forwarded immediately to our experts.
          </p>
        </div>

        {/* Form body */}
        <div className="space-y-5 px-8 py-6">
          {/* Salutation + Names */}
          <div className="grid grid-cols-[1fr_1.4fr_1.4fr] gap-3">
            <EnquiryField label="Salutation">
              <select
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              >
                <option value=""></option>
                <option value="mr">Mr.</option>
                <option value="ms">Ms.</option>
                <option value="dr">Dr.</option>
                <option value="other">Other</option>
              </select>
            </EnquiryField>
            <EnquiryField label="First name" required>
              <EnquiryInput value={firstName} onChange={setFirstName} />
            </EnquiryField>
            <EnquiryField label="Surname" required>
              <EnquiryInput value={surname} onChange={setSurname} />
            </EnquiryField>
          </div>

          <EnquiryField label="Email" required>
            <EnquiryInput type="email" value={email} onChange={setEmail} />
          </EnquiryField>

          <EnquiryField label="Phone" required>
            <EnquiryInput type="tel" value={phone} onChange={setPhone} />
          </EnquiryField>

          <EnquiryField label="Phone reachability">
            <select
              value={reachability}
              onChange={(e) => setReachability(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              <option value=""></option>
              <option value="morning">Morning (8–12)</option>
              <option value="afternoon">Afternoon (12–17)</option>
              <option value="evening">Evening (17–20)</option>
              <option value="anytime">Anytime</option>
            </select>
          </EnquiryField>

          {/* Address — pre-filled from landing */}
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-zinc-700">
              Address <span className="text-rose-500">*</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="grid grid-cols-[1fr_140px] divide-x divide-zinc-200">
                <input
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Street"
                  className="h-11 bg-white px-4 text-[14px] text-zinc-900 outline-none focus:bg-blue-50/30"
                />
                <input
                  value={houseNum}
                  onChange={(e) => setHouseNum(e.target.value)}
                  placeholder="No."
                  className="h-11 bg-white px-4 text-[14px] text-zinc-900 outline-none focus:bg-blue-50/30"
                />
              </div>
              <div className="grid grid-cols-[140px_1fr] divide-x divide-zinc-200 border-t border-zinc-200">
                <input
                  value={postal}
                  onChange={(e) => setPostal(e.target.value)}
                  placeholder="Postal"
                  className="h-11 bg-white px-4 text-[14px] text-zinc-900 outline-none focus:bg-blue-50/30"
                />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  className="h-11 bg-white px-4 text-[14px] text-zinc-900 outline-none focus:bg-blue-50/30"
                />
              </div>
            </div>
          </div>

          {/* Message */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-zinc-700">
              <span>Your message</span>
              <span className="text-[12px] text-zinc-400">{message.length} / 300</span>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 300))}
              rows={4}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[14px] text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          {/* Checkboxes */}
          <div className="space-y-2.5 pt-1">
            <Checkbox checked={isOwner} onChange={setIsOwner}>
              I am the owner of the building <span className="text-rose-500">*</span>
            </Checkbox>
            <Checkbox checked={acceptedPolicy} onChange={setAcceptedPolicy}>
              I have read the{' '}
              <a className="text-emerald-700 underline">data protection conditions</a>{' '}
              <span className="text-rose-500">*</span>
            </Checkbox>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-8 py-5">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[14px] font-semibold text-rose-600 hover:text-rose-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            Not now
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            className="group flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            Send
            <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EnquiryField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-zinc-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </div>
      {children}
    </div>
  );
}

function EnquiryInput({
  value,
  onChange,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-[14px] text-zinc-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
    />
  );
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-zinc-700">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition ${
          checked
            ? 'border-emerald-600 bg-emerald-600'
            : 'border-zinc-300 bg-white hover:border-zinc-400'
        }`}
      >
        {checked && (
          <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <span>{children}</span>
    </label>
  );
}

// ───────────────────────────────────────────────────────────────────
// Result dashboard — derived KPIs from manual inputs
// ───────────────────────────────────────────────────────────────────
function ResultDashboard() {
  const m = useStore((s) => s.manualInputs);
  const [detailOpen, setDetailOpen] = useState(false);

  const sym: Record<Currency, string> = { EUR: '€', GBP: '£', USD: '$' };
  const currency = sym[m.currency];
  const unitPrice = m.electricityPrice / 100; // ct/kWh → €/kWh

  const evKwh = m.hasEv && m.evAnnualKm ? Math.round((m.evAnnualKm * 20) / 100) : 0;
  const totalKwh = m.consumptionKwh + evKwh;
  const residentialCost = Math.round(m.consumptionKwh * unitPrice);
  const evCost = Math.round(evKwh * unitPrice);
  const totalCostBefore = residentialCost + evCost;

  const hasBattery = !!m.selectedBattery;
  const hasCharger = !!m.selectedCharger;

  // Run the same financial engine /api/design uses, with the user-chosen
  // package mapping to a kWp size + battery size. Replaces the previous
  // hardcoded ratios (38/63 % self-sufficiency, 8/11/14 years payback,
  // totalKwh×0.0004 CO₂) which had no relation to the rest of the app.
  const totalKwp = m.selectedPackage ? PACKAGE_KWP[m.selectedPackage] : 0;
  const batteryKwh = hasBattery && m.selectedBattery ? BATTERY_KWH[m.selectedBattery] : null;
  const fin = computeFinancials({
    totalKwp,
    batteryKwh,
    heatPumpKw: null,
    hasWallbox: hasCharger,
    annualConsumptionKwh: totalKwh,
    hasEv: !!m.hasEv,
    overrides: { retailPrice: unitPrice },
  });

  const selfSufficiency = Math.round(fin.selfConsumptionRatio * 100);
  const costAfter = Math.round(totalCostBefore - fin.annualSavingsEur);
  const yieldOver20 = fin.annualSavingsEur * 20;
  const breakEvenYears = Math.round(fin.paybackYears);
  const co2Tons = Math.round(fin.co2SavedTonsPer25y * 10) / 10;
  const trees = Math.round(co2Tons * 41);
  const flights = Math.round(co2Tons * 3.7);
  const yieldKwh = Math.round(totalKwp * ANNUAL_GENERATION_PER_KWP);

  // Sankey breakdown — only display heuristics now; totals match `fin`.
  // selfConsumedKwh from the engine is the ground truth for "solar that
  // didn't go to the grid". We split it across direct / battery / EV in
  // proportion to where each load actually lives.
  const evShare = m.hasEv ? Math.min(0.35, evKwh / Math.max(1, totalKwh)) : 0;
  const batShare = hasBattery ? 0.35 : 0;
  const directShare = Math.max(0, 1 - evShare - batShare);
  const solarDirectToHome = Math.round(fin.selfConsumedKwh * directShare);
  const solarToBattery = Math.round(fin.selfConsumedKwh * batShare);
  const solarToEV = Math.round(fin.selfConsumedKwh * evShare);
  const gridToHome = Math.max(0, m.consumptionKwh - solarDirectToHome - solarToBattery);
  const gridToEV = m.hasEv ? Math.max(0, evKwh - solarToEV) : 0;
  const solarToGrid = fin.exportedKwh;
  const ownConsumption = selfSufficiency;

  const fmtMoney = (v: number) =>
    `${currency}${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
      className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      {/* House illustration */}
      <div className="bg-zinc-50/60 px-6 pb-2 pt-6">
        <HouseDashboardIllustration
          hasSolar={!!m.selectedPackage || m.hasSolar === true}
          hasBattery={hasBattery}
          hasEv={m.hasEv === true}
          hasCharger={!!m.selectedCharger || m.hasEvCharger === true}
        />
      </div>

      {/* Power consumption summary */}
      <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 px-6 py-5">
        <div>
          <div className="text-[26px] font-bold leading-tight text-zinc-700">
            {totalKwh.toLocaleString('en-US')} kWh
          </div>
          <div className="text-[12.5px] font-semibold text-zinc-500">power consumption</div>
          <div className="mt-1 text-[11.5px] leading-snug text-zinc-500">
            {m.consumptionKwh.toLocaleString()} kWh for the residential
            {evKwh > 0 && (
              <>
                {' and'}
                <br />
                {evKwh.toLocaleString()} kWh for the e-car
              </>
            )}
          </div>
        </div>
        <div>
          <div className="text-[26px] font-bold leading-tight text-zinc-700">
            {fmtMoney(totalCostBefore)}
          </div>
          <div className="text-[12.5px] font-semibold text-zinc-500">Electricity costs</div>
          <div className="mt-1 text-[11.5px] leading-snug text-zinc-500">
            {fmtMoney(residentialCost)} for the residential
            {evCost > 0 && (
              <>
                {' and'}
                <br />
                {fmtMoney(evCost)} for the e-car
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sawtooth divider */}
      <div className="h-3 w-full bg-[radial-gradient(circle_at_5px_-3px,transparent_4px,#fafafa_4px)] [background-size:10px_10px]" />

      {/* 2x2 KPI grid */}
      <div className="grid grid-cols-2 gap-px bg-zinc-100">
        <KpiCell
          label="Yield"
          value={fmtMoney(yieldOver20)}
          sub="over 20 years"
          accent="up"
        />
        <KpiCell
          label="Electricity costs"
          value={fmtMoney(costAfter)}
          sub={`per year, i.e. ${selfSufficiency} % less`}
          accent="down"
        />
        <KpiCell label="Break-Even" value={`${breakEvenYears} years`}>
          <BreakEvenChart years={breakEvenYears} />
        </KpiCell>
        <KpiCell label="Self-sufficiency" value={`${selfSufficiency} %`} accent="up">
          <SelfSufficiencyDonut percent={selfSufficiency} hasBattery={hasBattery} />
        </KpiCell>
      </div>

      {/* CO2 savings */}
      <div className="border-t border-zinc-100 bg-white px-6 py-5">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-zinc-900">
          CO₂ savings <InfoDot />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-bold leading-tight text-blue-700">{co2Tons} tons</span>
          <svg className="h-4 w-4 text-blue-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="14 7 21 7 21 14" />
          </svg>
          <span className="text-[13px] text-zinc-500">per year</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <TreeIcon key={i} dim={i >= Math.min(6, Math.round(trees / 13))} />
              ))}
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <PlaneIcon key={i} dim={i >= Math.min(4, Math.max(1, flights))} />
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12.5px] font-semibold text-blue-700">{trees} trees / year</div>
            <div className="text-[12.5px] font-semibold text-blue-700">{flights} Flights / year</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        className="group flex w-full items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-[12.5px] font-semibold text-white transition hover:bg-blue-700"
      >
        Results in detail
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

      <AnimatePresence>
        {detailOpen && (
          <ResultsDetailModal
            onClose={() => setDetailOpen(false)}
            yieldKwh={yieldKwh}
            selfSufficiency={selfSufficiency}
            ownConsumption={ownConsumption}
            solarDirectToHome={solarDirectToHome}
            solarToBattery={solarToBattery}
            solarToEV={solarToEV}
            gridToHome={gridToHome}
            gridToEV={gridToEV}
            solarToGrid={solarToGrid}
            hasBattery={hasBattery}
            hasEv={m.hasEv === true}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Results in detail modal
// ───────────────────────────────────────────────────────────────────
interface ResultsDetailProps {
  onClose: () => void;
  yieldKwh: number;
  selfSufficiency: number;
  ownConsumption: number;
  solarDirectToHome: number;
  solarToBattery: number;
  solarToEV: number;
  gridToHome: number;
  gridToEV: number;
  solarToGrid: number;
  hasBattery: boolean;
  hasEv: boolean;
}

function ResultsDetailModal(p: ResultsDetailProps) {
  const [tab, setTab] = useState<'info' | 'fin' | 'co2'>('info');
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={p.onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="relative w-full max-w-5xl rounded-3xl bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <h2 className="text-[28px] font-extrabold tracking-tight text-zinc-900">
            Results in detail
          </h2>
          <button
            type="button"
            onClick={p.onClose}
            className="flex items-center gap-1.5 text-[14px] font-medium text-zinc-500 hover:text-zinc-900"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-7 flex gap-2">
          {([
            ['info', 'Information'],
            ['fin', 'Financials'],
            ['co2', 'Climate protection'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2 text-[13.5px] font-semibold transition ${
                tab === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <>
            <h3 className="mb-3 text-[20px] font-bold text-zinc-900">At a glance</h3>
            <div className="mb-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-zinc-100">
              <GlanceCell value={p.yieldKwh.toLocaleString('en-US')} unit="kWh" label="Electricity yield" />
              <GlanceCell value={String(p.selfSufficiency)} unit="%" label="Self-sufficiency" />
              <GlanceCell value={String(p.ownConsumption)} unit="%" label="Own consumption" />
            </div>

            <h3 className="mb-4 text-[20px] font-bold text-zinc-900">
              That&apos;s how you use your electricity
            </h3>
            <div className="rounded-2xl bg-zinc-50 p-6">
              <SankeyDiagram
                solarDirectToHome={p.solarDirectToHome}
                solarToBattery={p.solarToBattery}
                solarToEV={p.solarToEV}
                gridToHome={p.gridToHome}
                gridToEV={p.gridToEV}
                solarToGrid={p.solarToGrid}
                hasBattery={p.hasBattery}
                hasEv={p.hasEv}
              />
              <p className="mt-5 text-[14px] leading-relaxed text-zinc-600">
                <strong>{p.solarDirectToHome.toLocaleString()} kWh</strong> of your solar
                system flows directly into your residential
                {p.hasEv && p.solarToEV > 0 && (
                  <>, <strong>{p.solarToEV.toLocaleString()} kWh</strong> directly into your electric car</>
                )}
                {p.hasBattery && (
                  <> and <strong>{p.solarToBattery.toLocaleString()} kWh</strong> into power storage</>
                )}
                . The remaining electricity, i.e.{' '}
                <strong>{p.solarToGrid.toLocaleString()} kWh</strong>, is fed into the grid.
              </p>
            </div>
          </>
        )}

        {tab === 'fin' && (
          <div className="rounded-2xl bg-zinc-50 p-12 text-center text-[14px] text-zinc-500">
            Financial breakdown coming soon.
          </div>
        )}
        {tab === 'co2' && (
          <div className="rounded-2xl bg-zinc-50 p-12 text-center text-[14px] text-zinc-500">
            Climate protection breakdown coming soon.
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function GlanceCell({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="bg-white px-6 py-5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[36px] font-extrabold leading-none text-zinc-900">{value}</span>
        <span className="text-[14px] font-semibold text-zinc-500">{unit}</span>
      </div>
      <div className="mt-2 text-[13px] text-zinc-500">{label}</div>
    </div>
  );
}

function SankeyDiagram({
  solarDirectToHome,
  solarToBattery,
  solarToEV,
  gridToHome,
  gridToEV,
  solarToGrid,
  hasBattery,
  hasEv,
}: {
  solarDirectToHome: number;
  solarToBattery: number;
  solarToEV: number;
  gridToHome: number;
  gridToEV: number;
  solarToGrid: number;
  hasBattery: boolean;
  hasEv: boolean;
}) {
  // Layout: Solar (left) → [Battery/Grid] (mid) → Demand/EV (right)
  const W = 880;
  const H = 360;
  const solarTotal = solarDirectToHome + solarToBattery + solarToEV + solarToGrid;
  const demandTotal = solarDirectToHome + (hasBattery ? solarToBattery : 0) + gridToHome;
  const evTotal = hasEv ? solarToEV + gridToEV : 0;
  const gridInTotal = gridToHome + gridToEV;
  const batteryTotal = solarToBattery;

  // Scale factor: max kWh that fits the column height (H - padding)
  const maxFlow = Math.max(solarTotal, demandTotal + evTotal, 1);
  const scale = (H - 60) / maxFlow;

  // Source column (Solar)
  const solarH = solarTotal * scale;
  const solarY = (H - solarH) / 2;

  // Mid column: Battery on top, Grid below
  const batH = batteryTotal * scale;
  const gridH = gridInTotal * scale;
  const midGap = 30;
  const midTotalH = batH + gridH + (batH > 0 && gridH > 0 ? midGap : 0);
  const midStartY = (H - midTotalH) / 2;
  const batY = batH > 0 ? midStartY : 0;
  const gridY = batH > 0 ? midStartY + batH + midGap : midStartY;

  // Sink column (Demand top, EV bottom)
  const demH = demandTotal * scale;
  const evH = evTotal * scale;
  const sinkGap = 30;
  const sinkTotalH = demH + evH + (demH > 0 && evH > 0 ? sinkGap : 0);
  const sinkStartY = (H - sinkTotalH) / 2;
  const demY = sinkStartY;
  const evY = demH > 0 ? sinkStartY + demH + sinkGap : sinkStartY;

  // Column X positions
  const xSolar = 80;
  const xMid = 360;
  const xSink = 760;
  const nodeW = 14;

  // Track flow positions on each node (cumulative)
  let solarOff = 0;
  const flowSolarToHome = bandY(solarY, solarOff, solarDirectToHome * scale);
  solarOff += solarDirectToHome * scale;
  const flowSolarToBat = bandY(solarY, solarOff, batH);
  solarOff += batH;
  const flowSolarToEV = bandY(solarY, solarOff, solarToEV * scale);
  solarOff += solarToEV * scale;
  const flowSolarToGrid = bandY(solarY, solarOff, solarToGrid * scale);

  let demOff = 0;
  const inDemFromSolar = bandY(demY, demOff, solarDirectToHome * scale);
  demOff += solarDirectToHome * scale;
  const inDemFromBat = bandY(demY, demOff, batH);
  demOff += batH;
  const inDemFromGrid = bandY(demY, demOff, gridToHome * scale);

  let evOff = 0;
  const inEVFromSolar = bandY(evY, evOff, solarToEV * scale);
  evOff += solarToEV * scale;
  const inEVFromGrid = bandY(evY, evOff, gridToEV * scale);

  let gridOff = 0;
  const outGridToHome = bandY(gridY, gridOff, gridToHome * scale);
  gridOff += gridToHome * scale;
  const outGridToEV = bandY(gridY, gridOff, gridToEV * scale);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
      {/* Flows */}
      {solarDirectToHome > 0 && (
        <SankeyFlow
          x1={xSolar + nodeW}
          x2={xSink}
          band1={flowSolarToHome}
          band2={inDemFromSolar}
          color="#93c5fd"
        />
      )}
      {batteryTotal > 0 && (
        <>
          <SankeyFlow
            x1={xSolar + nodeW}
            x2={xMid}
            band1={flowSolarToBat}
            band2={{ y: batY, h: batH }}
            color="#93c5fd"
          />
          <SankeyFlow
            x1={xMid + nodeW}
            x2={xSink}
            band1={{ y: batY, h: batH }}
            band2={inDemFromBat}
            color="#93c5fd"
          />
        </>
      )}
      {solarToGrid > 0 && (
        <SankeyFlow
          x1={xSolar + nodeW}
          x2={xMid}
          band1={flowSolarToGrid}
          band2={{ y: gridY, h: solarToGrid * scale }}
          color="#bfdbfe"
        />
      )}
      {gridToHome > 0 && (
        <SankeyFlow
          x1={xMid + nodeW}
          x2={xSink}
          band1={outGridToHome}
          band2={inDemFromGrid}
          color="#cbd5e1"
        />
      )}
      {hasEv && solarToEV > 0 && (
        <SankeyFlow
          x1={xSolar + nodeW}
          x2={xSink}
          band1={flowSolarToEV}
          band2={inEVFromSolar}
          color="#86efac"
        />
      )}
      {hasEv && gridToEV > 0 && (
        <SankeyFlow
          x1={xMid + nodeW}
          x2={xSink}
          band1={outGridToEV}
          band2={inEVFromGrid}
          color="#bbf7d0"
        />
      )}

      {/* Nodes */}
      <rect x={xSolar} y={solarY} width={nodeW} height={solarH} fill="#1e3a8a" rx="2" />
      <text x={xSolar - 10} y={solarY + solarH / 2 + 4} textAnchor="end" className="text-[13px] font-medium" fill="#1f2937">
        Solar
      </text>

      {batteryTotal > 0 && (
        <>
          <rect x={xMid} y={batY} width={nodeW} height={batH} fill="#1e3a8a" rx="2" />
          <text x={xMid + nodeW + 8} y={batY + batH / 2 + 4} className="text-[13px] font-medium" fill="#1f2937">
            Battery Storage
          </text>
        </>
      )}
      {gridInTotal > 0 && (
        <>
          <rect x={xMid} y={gridY} width={nodeW} height={gridH} fill="#1e3a8a" rx="2" />
          <text x={xMid + nodeW + 8} y={gridY + gridH / 2 + 4} className="text-[13px] font-medium" fill="#1f2937">
            Grid
          </text>
        </>
      )}

      <rect x={xSink} y={demY} width={nodeW} height={demH} fill="#1e3a8a" rx="2" />
      <text x={xSink + nodeW + 8} y={demY + demH / 2 + 4} className="text-[13px] font-medium" fill="#1f2937">
        Demand
      </text>
      {hasEv && evTotal > 0 && (
        <>
          <rect x={xSink} y={evY} width={nodeW} height={evH} fill="#16a34a" rx="2" />
          <text x={xSink + nodeW + 8} y={evY + evH / 2 + 4} className="text-[13px] font-medium" fill="#1f2937">
            Electric vehicle
          </text>
        </>
      )}
    </svg>
  );
}

function bandY(start: number, offset: number, height: number) {
  return { y: start + offset, h: height };
}

function SankeyFlow({
  x1,
  x2,
  band1,
  band2,
  color,
}: {
  x1: number;
  x2: number;
  band1: { y: number; h: number };
  band2: { y: number; h: number };
  color: string;
}) {
  if (band1.h <= 0 || band2.h <= 0) return null;
  const cx = (x1 + x2) / 2;
  const top = `M ${x1} ${band1.y} C ${cx} ${band1.y}, ${cx} ${band2.y}, ${x2} ${band2.y}`;
  const bot = `L ${x2} ${band2.y + band2.h} C ${cx} ${band2.y + band2.h}, ${cx} ${band1.y + band1.h}, ${x1} ${band1.y + band1.h} Z`;
  return <path d={`${top} ${bot}`} fill={color} fillOpacity={0.7} />;
}

function KpiCell({
  label,
  value,
  sub,
  children,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
  accent?: 'up' | 'down';
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-white px-5 py-4">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-zinc-900">
        {label}
        {label === 'Break-Even' && <InfoDot />}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[24px] font-bold leading-tight text-blue-700">{value}</span>
        {accent === 'up' && (
          <svg className="h-4 w-4 text-blue-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="14 7 21 7 21 14" />
          </svg>
        )}
        {accent === 'down' && (
          <svg className="h-4 w-4 text-blue-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 7 9 13 13 9 21 17" />
            <polyline points="14 17 21 17 21 10" />
          </svg>
        )}
      </div>
      {sub && <div className="text-[12px] text-zinc-500">{sub}</div>}
      {children}
    </div>
  );
}

function BreakEvenChart({ years }: { years: number }) {
  const total = 20;
  return (
    <div className="mt-2 flex items-end gap-[3px]">
      {Array.from({ length: total }).map((_, i) => {
        const isGreen = i < years;
        const height = 6 + (i / total) * 22;
        return (
          <div
            key={i}
            className={`w-[6px] rounded-sm ${isGreen ? 'bg-emerald-600' : 'bg-blue-500/70'}`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

function SelfSufficiencyDonut({ percent, hasBattery }: { percent: number; hasBattery: boolean }) {
  // Three slices: solar (direct) + storage (battery) + grid (rest).
  const solar = hasBattery ? Math.round(percent * 0.55) : percent;
  const storage = hasBattery ? percent - solar : 0;
  const grid = 100 - percent;
  const slices = [
    { label: 'Solar', pct: solar, color: '#1e40af' },
    { label: 'Storage', pct: storage, color: '#3b82f6' },
    { label: 'Grid', pct: grid, color: '#93c5fd' },
  ].filter((s) => s.pct > 0);

  const c = 2 * Math.PI * 28;
  let offset = 0;
  return (
    <div className="mt-2 flex items-center gap-3">
      <svg width="64" height="64" viewBox="-32 -32 64 64" style={{ transform: 'rotate(-90deg)' }}>
        {slices.map((s, i) => {
          const len = (s.pct / 100) * c;
          const dash = `${len} ${c - len}`;
          const dashOffset = -offset;
          offset += len;
          return (
            <circle
              key={i}
              r="28"
              fill="transparent"
              stroke={s.color}
              strokeWidth="8"
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <div className="flex flex-col gap-0.5 text-[10.5px]">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="font-medium text-zinc-700">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HouseDashboardIllustration({
  hasSolar,
  hasBattery,
  hasEv,
  hasCharger,
}: {
  hasSolar: boolean;
  hasBattery: boolean;
  hasEv: boolean;
  hasCharger: boolean;
}) {
  return (
    <svg viewBox="0 0 360 220" className="h-44 w-full">
      {/* Tree */}
      <circle cx="36" cy="160" r="20" fill="#bfbfbf" />
      <rect x="33" y="170" width="6" height="20" fill="#9a9a9a" />
      {/* Heat pump */}
      <rect x="60" y="155" width="40" height="35" rx="2" fill="#bdbdbd" />
      <circle cx="80" cy="172" r="9" fill="#a1a1a1" />
      <line x1="100" y1="170" x2="120" y2="170" stroke="#a1a1a1" strokeWidth="3" />
      {/* Main house left */}
      <polygon points="120,90 180,40 240,90 240,200 120,200" fill="#d4d4d4" />
      <polygon points="120,90 180,40 240,90" fill="#bfbfbf" />
      <line x1="120" y1="140" x2="240" y2="140" stroke="#999" strokeWidth="0.8" opacity="0.6" />
      {/* Window left */}
      <rect x="135" y="148" width="22" height="28" fill="#f3f3f3" stroke="#999" />
      <line x1="146" y1="148" x2="146" y2="176" stroke="#999" />
      {/* Sofa */}
      <rect x="168" y="160" width="30" height="14" rx="2" fill="#9a9a9a" />
      {/* Right wing */}
      <polygon points="240,110 270,80 300,110 300,200 240,200" fill="#d4d4d4" />
      <polygon points="240,110 270,80 300,110" fill="#bfbfbf" />
      {/* Lamps */}
      <line x1="180" y1="90" x2="180" y2="100" stroke="#9a9a9a" />
      <circle cx="180" cy="103" r="2.5" fill="#9a9a9a" />
      <line x1="200" y1="120" x2="200" y2="130" stroke="#9a9a9a" />
      <circle cx="200" cy="133" r="2.5" fill="#9a9a9a" />
      {/* Solar panels on roofs */}
      {hasSolar && (
        <>
          <rect x="183" y="56" width="50" height="6" rx="1" fill="#2563eb" transform="rotate(-37 208 59)" />
          <rect x="244" y="86" width="40" height="6" rx="1" fill="#2563eb" transform="rotate(-45 264 89)" />
        </>
      )}
      {/* Power storage in basement */}
      {hasBattery && (
        <g>
          <rect x="155" y="180" width="22" height="20" rx="2" fill="#86efac" />
          <rect x="160" y="184" width="6" height="12" fill="#facc15" />
          <rect x="167" y="184" width="6" height="12" fill="#facc15" />
        </g>
      )}
      {/* EV Charger box */}
      {hasCharger && (
        <g>
          <rect x="285" y="155" width="14" height="22" rx="2" fill="#fafafa" stroke="#222" />
          <rect x="288" y="160" width="8" height="4" rx="0.5" fill="#facc15" />
          <path d="M299 175 Q310 175 310 185 L320 188" stroke="#22c55e" strokeWidth="2" fill="none" />
        </g>
      )}
      {/* Electric car */}
      {hasEv && (
        <g transform="translate(312 172)">
          <ellipse cx="22" cy="20" rx="22" ry="3" fill="#000" opacity="0.15" />
          <path d="M2 16 L8 8 Q11 5 16 5 L30 5 Q35 5 38 8 L44 16 Z" fill="#1e3a8a" />
          <rect x="2" y="14" width="42" height="6" rx="2" fill="#1e3a8a" />
          <circle cx="11" cy="22" r="3.2" fill="#222" />
          <circle cx="35" cy="22" r="3.2" fill="#222" />
        </g>
      )}
      {/* Labels */}
      {hasSolar && <Tag x={185} y={28} text="Solar system" check />}
      {hasBattery && <Tag x={120} y={208} text="Power storage" check />}
      {hasCharger && <Tag x={300} y={142} text="EV Charger" check />}
      {hasEv && <Tag x={303} y={208} text="Electric car" check />}
    </svg>
  );
}

function Tag({ x, y, text, check }: { x: number; y: number; text: string; check?: boolean }) {
  const w = text.length * 5.5 + 26;
  return (
    <g transform={`translate(${x - w / 2} ${y - 11})`}>
      <rect width={w} height="22" rx="11" fill="#dcfce7" />
      {check && (
        <g transform="translate(8 8)">
          <polyline points="0,3 3,6 8,1" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      <text x={check ? 22 : 10} y={15} fontSize="9.5" fontWeight="700" fill="#15803d">
        {text}
      </text>
    </g>
  );
}

function TreeIcon({ dim }: { dim?: boolean }) {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
      <path d="M7 0 L13 9 L11 9 L13 14 L1 14 L3 9 L1 9 Z" fill={dim ? '#bfdbfe' : '#1d4ed8'} />
      <rect x="6" y="14" width="2" height="4" fill={dim ? '#bfdbfe' : '#1d4ed8'} />
    </svg>
  );
}

function PlaneIcon({ dim }: { dim?: boolean }) {
  return (
    <svg width="20" height="12" viewBox="0 0 24 14" fill="none">
      <path d="M2 7 L10 6 L14 1 L16 1 L14 6 L20 5 L22 7 L20 9 L14 8 L16 13 L14 13 L10 8 L2 7 Z" fill={dim ? '#bfdbfe' : '#1d4ed8'} />
    </svg>
  );
}

function InfoDot() {
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-800 text-[8px] font-bold text-white">
      i
    </span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3z" />
    </svg>
  );
}
function SolarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="15" y1="5" x2="15" y2="19" />
    </svg>
  );
}
function WavesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4c2 4 0 6 0 10s2 6 0 10" />
      <path d="M11 4c2 4 0 6 0 10s2 6 0 10" />
      <path d="M17 4c2 4 0 6 0 10s2 6 0 10" />
    </svg>
  );
}
function EvCarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 11l1.5-4A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1a1 1 0 0 1-2 0v-1H7v1a1 1 0 0 1-2 0v-1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1zm2-1h10l-1-3H8l-1 3zm-1 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm12 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM10.5 8.5h-2l1-2h3l-1 2zm.7 1.4 1-1.5h2l1 1.5h-4z" />
    </svg>
  );
}
function ChargerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="10" height="18" rx="1.5" />
      <line x1="9" y1="7" x2="13" y2="7" />
      <path d="M16 11h2.5a1.5 1.5 0 0 1 1.5 1.5V15a2 2 0 0 1-2 2" />
      <path d="M11 14l-2 3h4l-2 3" />
    </svg>
  );
}
function PeopleIcon({ count, active }: { count: number; active: boolean }) {
  const fill = active ? '#2563EB' : '#52525b';
  const positions =
    count === 1
      ? [0]
      : count === 2
      ? [-4, 4]
      : count === 3
      ? [-6, 0, 6]
      : [-7.5, -2.5, 2.5, 7.5];
  return (
    <svg width="28" height="20" viewBox="-14 -10 28 20" fill={fill}>
      {positions.map((x, i) => (
        <g key={i} transform={`translate(${x}, 0)`}>
          <circle cx="0" cy="-4" r="2.2" />
          <path d="M-2.5 -1 a 2.5 2 0 0 1 5 0 v 5 h -5 z" />
        </g>
      ))}
    </svg>
  );
}
