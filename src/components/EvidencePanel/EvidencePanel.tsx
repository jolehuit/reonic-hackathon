// Reonic Evidence panel — OWNED by Dev C
// Shows 3 similar projects from the dataset with absolute deltas.
'use client';

import { useStore } from '@/lib/store';

export function EvidencePanel() {
  const design = useStore((s) => s.design);

  if (!design) return null;

  const ourPrice = design.totalPriceEur;
  const medianPrice = ourPrice + design.deltaVsMedian.priceEur;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
      <div className="mb-3 text-[10px] uppercase tracking-wider text-zinc-500">Reonic Evidence</div>
      <div className="space-y-1 font-mono text-xs">
        {design.similarProjects.slice(0, 3).map((p) => (
          <div key={p.projectId} className="flex justify-between text-zinc-400">
            <span>#{p.projectId.slice(0, 6)} {p.energyDemandKwh} kWh{p.hasEv ? ' + EV' : ''}</span>
            <span>{p.totalKwp} kWp · {p.batteryKwh} kWh · €{p.priceEur}</span>
          </div>
        ))}
        <div className="mt-3 border-t border-zinc-800 pt-2 text-zinc-300">
          <div>Median: {(design.totalKwp + design.deltaVsMedian.kwp).toFixed(1)} kWp · €{medianPrice}</div>
          <div className="text-amber-300">
            Ours: {design.totalKwp} kWp · €{design.totalPriceEur}{' '}
            <span className="text-zinc-500">
              ({design.deltaVsMedian.kwp >= 0 ? '+' : ''}
              {design.deltaVsMedian.kwp.toFixed(1)} kWp)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
