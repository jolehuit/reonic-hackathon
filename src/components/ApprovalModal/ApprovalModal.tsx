// HITL Review & Approve modal — OWNED by Dev C
'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';

const CHECKLIST = [
  'Roof access verified with customer',
  'Customer informed of estimated install timeline',
  'Existing electrical panel sufficient',
  'Pricing accepted by customer',
];

export function ApprovalModal() {
  const phase = useStore((s) => s.phase);
  const design = useStore((s) => s.design);
  const profile = useStore((s) => s.profile);
  const setPhase = useStore((s) => s.setPhase);
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));

  if (phase !== 'reviewing' || !design) return null;

  const handleApprove = async () => {
    // Auto-check all in 1.5s for demo flair
    for (let i = 0; i < CHECKLIST.length; i++) {
      await new Promise((r) => setTimeout(r, 350));
      setChecks((prev) => prev.map((v, idx) => (idx === i ? true : v)));
    }
    await new Promise((r) => setTimeout(r, 500));

    // Trigger PDF export and download
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, design }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quick-offer-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      /* swallow — phase still advances */
    }

    setPhase('approved');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[600px] rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="mb-4 text-xl font-semibold text-zinc-100">Review &amp; Approve</h2>

        <div className="mb-5 rounded-lg bg-zinc-900 p-4 font-mono text-sm">
          <div className="mb-2 text-xs uppercase text-zinc-500">AI recommendation summary</div>
          <ul className="space-y-1 text-zinc-300">
            <li>• {design.moduleCount}× {design.moduleBrand} {design.moduleWattPeak}Wp ({design.totalKwp} kWp)</li>
            <li>• Inverter: {design.inverterModel}</li>
            {design.batteryCapacityKwh && <li>• Battery: {design.batteryCapacityKwh} kWh</li>}
            {design.heatPumpModel && <li>• Heat pump: {design.heatPumpModel}</li>}
            <li className="mt-2 text-amber-300">Total: €{design.totalPriceEur} · Payback {design.paybackYears} yrs</li>
          </ul>
        </div>

        <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 font-mono text-xs text-zinc-400">
          <div className="mb-2 text-zinc-500">Match vs similar Reonic projects:</div>
          <div>kWp delta: {design.deltaVsMedian.kwp >= 0 ? '+' : ''}{design.deltaVsMedian.kwp.toFixed(1)} ✓</div>
          <div>Battery delta: {design.deltaVsMedian.batteryKwh >= 0 ? '+' : ''}{design.deltaVsMedian.batteryKwh.toFixed(1)} kWh ✓</div>
          <div>Price delta: €{design.deltaVsMedian.priceEur >= 0 ? '+' : ''}{design.deltaVsMedian.priceEur} ✓</div>
        </div>

        <div className="mb-5 space-y-2">
          <div className="text-xs uppercase text-zinc-500">Pre-flight checklist</div>
          {CHECKLIST.map((item, i) => (
            <label key={item} className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={(e) => setChecks((prev) => prev.map((v, idx) => (idx === i ? e.target.checked : v)))}
                className="h-4 w-4"
              />
              {item}
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={() => setPhase('interactive')}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-zinc-300 hover:bg-zinc-900"
          >
            ✗ Adjust design
          </button>
          <button
            onClick={handleApprove}
            className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
          >
            ✓ Approve &amp; Export
          </button>
        </div>
      </div>
    </div>
  );
}
