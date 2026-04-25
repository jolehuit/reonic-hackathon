'use client';

import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import type { SimilarProject } from '@/lib/types';

export function EvidencePanel() {
  const design = useStore((s) => s.design);

  if (!design) return null;

  const ourKwp = design.totalKwp;
  const medianKwp = ourKwp + design.deltaVsMedian.kwp;
  const medianPrice = design.totalPriceEur + design.deltaVsMedian.priceEur;
  const projects = design.similarProjects.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
        <div>
          <h3 className="text-[14px] font-bold tracking-tight text-zinc-900">Reonic evidence</h3>
          <p className="text-[11px] text-zinc-500">3 most similar deliveries</p>
        </div>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
          1 620 projects
        </span>
      </div>

      <div className="space-y-2 px-5 py-4">
        {projects.map((p, i) => (
          <ProjectRow key={p.projectId} project={p} delay={i * 0.08} />
        ))}
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-3.5">
        <div className="mb-1 flex items-center justify-between text-[12px]">
          <span className="text-zinc-500">Median similar</span>
          <span className="font-mono font-semibold text-zinc-700">
            {medianKwp.toFixed(1)} kWp · €{medianPrice.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-blue-700">Our design</span>
          <span className="flex items-center gap-2 font-mono font-bold text-blue-700">
            {ourKwp.toFixed(1)} kWp · €{design.totalPriceEur.toLocaleString()}
            <DeltaBadge value={design.deltaVsMedian.kwp} unit="kWp" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function ProjectRow({ project, delay }: { project: SimilarProject; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
      className="rounded-xl border border-zinc-100 bg-white px-3.5 py-2.5 transition hover:border-blue-200"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10.5px] text-zinc-500">
          #{project.projectId.slice(0, 8)}
        </span>
        {project.hasEv && (
          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
            EV
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-zinc-600">{project.energyDemandKwh.toLocaleString()} kWh/y</span>
        <div className="flex items-center gap-1 font-mono font-semibold">
          <span className="text-blue-600">{project.totalKwp.toFixed(1)}</span>
          <span className="text-[10px] text-zinc-400">kWp</span>
          <span className="text-zinc-300">·</span>
          <span className="text-emerald-600">{project.batteryKwh.toFixed(1)}</span>
          <span className="text-[10px] text-zinc-400">kWh</span>
        </div>
      </div>
      <div className="mt-0.5 text-right font-mono text-[10.5px] text-zinc-400">
        €{project.priceEur.toLocaleString()}
      </div>
    </motion.div>
  );
}

function DeltaBadge({ value, unit }: { value: number; unit: string }) {
  const positive = value >= 0;
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
        positive ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'
      }`}
    >
      {positive ? '+' : ''}
      {value.toFixed(1)} {unit}
    </span>
  );
}
