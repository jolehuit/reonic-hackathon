// KPI sidebar — OWNED by Dev C
// Shows kWp, battery, total, payback as animated numbers (framer-motion springs).
'use client';

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';

export function KPISidebar() {
  const design = useStore((s) => s.design);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
      <div className="mb-3 text-[10px] uppercase tracking-wider text-zinc-500">KPIs</div>
      <div className="space-y-2 font-mono text-sm">
        <Kpi label="Power" value={design?.totalKwp ?? 0} suffix=" kWp" decimals={1} />
        <Kpi label="Battery" value={design?.batteryCapacityKwh ?? 0} suffix=" kWh" decimals={1} />
        <Kpi label="Price" value={design?.totalPriceEur ?? 0} prefix="€" />
        <Kpi label="Payback" value={design?.paybackYears ?? 0} suffix=" yrs" decimals={1} />
      </div>
    </div>
  );
}

function Kpi({ label, value, prefix = '', suffix = '', decimals = 0 }: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const spring = useSpring(0, { stiffness: 80, damping: 15 });
  const display = useTransform(spring, (v) => `${prefix}${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return (
    <div className="flex justify-between border-b border-zinc-800 pb-1">
      <span className="text-zinc-500">{label}</span>
      <motion.span className="text-zinc-100">{display}</motion.span>
    </div>
  );
}
