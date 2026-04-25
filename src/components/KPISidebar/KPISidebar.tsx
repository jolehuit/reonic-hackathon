'use client';

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';

export function KPISidebar() {
  const design = useStore((s) => s.design);
  const profile = useStore((s) => s.profile);

  const totalKwp = design?.totalKwp ?? 0;
  const battery = design?.batteryCapacityKwh ?? 0;
  const price = design?.totalPriceEur ?? 0;
  const payback = design?.paybackYears ?? 0;
  const co2 = design?.co2SavedTonsPer25y ?? 0;
  const consumption = profile?.annualConsumptionKwh ?? 0;
  const evKm = profile?.hasEv ? profile.evAnnualKm ?? 0 : 0;
  const evKwh = Math.round(evKm * 0.18);
  const residentialKwh = Math.max(0, consumption - evKwh);

  const ownConsumptionPct = 62;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 }}
      className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
        <div>
          <h3 className="text-[14px] font-bold tracking-tight text-zinc-900">Your design</h3>
          <p className="text-[11px] text-zinc-500">k-NN match · 1 620 deliveries</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Live
        </span>
      </div>

      {/* Top KPIs grid 2×2 */}
      <div className="grid grid-cols-2 gap-px bg-zinc-100">
        <BigKpi
          value={consumption}
          decimals={0}
          suffix=" kWh"
          label="Power consumption"
          sub={`${residentialKwh.toLocaleString()} kWh residential${evKwh ? ` + ${evKwh.toLocaleString()} kWh e-car` : ''}`}
        />
        <BigKpi
          value={price}
          decimals={0}
          prefix="€"
          label="Total investment"
          sub="One-time, incl. installation"
        />
        <BigKpi
          value={payback}
          decimals={1}
          suffix=" yrs"
          label="Break-even"
          sub="vs. grid baseline"
          accent="emerald"
        />
        <BigKpi
          value={ownConsumptionPct}
          decimals={0}
          suffix="%"
          label="Own consumption"
          sub="self-sufficiency"
          accent="blue"
        />
      </div>

      {/* Compact line items */}
      <div className="space-y-2.5 px-5 py-4">
        <CompactKpi icon={<SunIcon />} tone="blue" label="System power" value={totalKwp} suffix=" kWp" decimals={1} />
        {battery > 0 && (
          <CompactKpi icon={<BatteryIcon />} tone="emerald" label="Battery" value={battery} suffix=" kWh" decimals={1} />
        )}
        <CompactKpi icon={<LeafIcon />} tone="emerald" label="CO₂ saved · 25 yrs" value={co2} suffix=" tons" decimals={1} />
      </div>
    </motion.div>
  );
}

function BigKpi({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  label,
  sub,
  accent,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  sub?: string;
  accent?: 'emerald' | 'blue';
}) {
  const spring = useSpring(0, { stiffness: 80, damping: 16 });
  const display = useTransform(spring, (v) =>
    `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  const valueColor = accent === 'emerald'
    ? 'text-emerald-700'
    : accent === 'blue'
      ? 'text-blue-700'
      : 'text-zinc-900';

  return (
    <div className="bg-white px-5 py-4">
      <motion.div className={`text-[22px] font-bold leading-tight tabular-nums tracking-tight ${valueColor}`}>
        {display}
      </motion.div>
      <div className="mt-0.5 text-[11.5px] font-medium text-zinc-700">{label}</div>
      {sub && <div className="mt-1 text-[10.5px] leading-snug text-zinc-400">{sub}</div>}
    </div>
  );
}

function CompactKpi({
  icon,
  tone,
  label,
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
}: {
  icon: React.ReactNode;
  tone: 'blue' | 'emerald';
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const spring = useSpring(0, { stiffness: 80, damping: 16 });
  const display = useTransform(spring, (v) =>
    `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  const toneBg = tone === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600';

  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneBg}`}>
        {icon}
      </div>
      <div className="flex flex-1 items-center justify-between">
        <span className="text-[12px] font-medium text-zinc-500">{label}</span>
        <motion.span className="text-[14px] font-bold tabular-nums text-zinc-900">
          {display}
        </motion.span>
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function BatteryIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="7" width="18" height="10" rx="2" />
      <line x1="22" y1="11" x2="22" y2="13" />
      <line x1="6" y1="10" x2="6" y2="14" />
      <line x1="10" y1="10" x2="10" y2="14" />
    </svg>
  );
}
function LeafIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.5c1 1.5 1.8 4 1.8 6.5 0 6.5-5 11-10 11Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
}
