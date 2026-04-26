'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { useEffectiveDesign } from '@/lib/useEffectiveDesign';
import type { HouseId } from '@/lib/types';

const CHECKLIST = [
  'Roof access verified with customer',
  'Customer informed of estimated install timeline',
  'Existing electrical panel sufficient',
  'Pricing accepted by customer',
];

const HOUSE_LOCATION: Record<HouseId, string> = {
  brandenburg: 'Thielallee 36, Berlin, Germany',
  hamburg: 'Test addr 2, Potsdam-Golm, Germany',
  ruhr: 'Schönerlinder Weg 83, Berlin Karow, Germany',
};

export function ApprovalModal() {
  const phase = useStore((s) => s.phase);
  // Effective design — reflects refinement toggles + slider + manual panel
  // edits — so the modal and the PDF that ships always match the sidebar.
  const design = useEffectiveDesign();
  const profile = useStore((s) => s.profile);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const customAddress = useStore((s) => s.customAddress);
  const setPhase = useStore((s) => s.setPhase);
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [exporting, setExporting] = useState(false);

  const open = phase === 'reviewing' && !!design;

  const handleApprove = async () => {
    if (!design) return;
    setExporting(true);

    for (let i = 0; i < CHECKLIST.length; i++) {
      await new Promise((r) => setTimeout(r, 320));
      setChecks((prev) => prev.map((v, idx) => (idx === i ? true : v)));
    }
    await new Promise((r) => setTimeout(r, 400));

    const address =
      selectedHouse && selectedHouse !== 'custom'
        ? HOUSE_LOCATION[selectedHouse]
        : customAddress?.formatted;

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, design, address }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iconic-quick-offer-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      // swallow — phase still advances
    }

    setExporting(false);
    // Drop back to interactive so the user can keep adjusting the design
    // after the PDF has been generated, instead of being bounced to landing.
    setPhase('interactive');
    setChecks(CHECKLIST.map(() => false));
  };

  return (
    <AnimatePresence>
      {open && design && (
        <motion.div
          key="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25)]"
          >
            {/* Header */}
            <div className="border-b border-zinc-100 px-7 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[20px] font-bold tracking-tight text-zinc-900">Review &amp; Approve</h2>
                  <p className="mt-0.5 text-[13px] text-zinc-500">
                    Final check before sending the quick-offer to your customer.
                  </p>
                </div>
                <button
                  onClick={() => setPhase('interactive')}
                  disabled={exporting}
                  className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="space-y-6 px-7 py-6">
              {/* Summary */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  AI recommendation
                </h3>
                <div className="space-y-2 rounded-xl bg-zinc-50 p-4">
                  <SummaryRow
                    icon="☀"
                    label="Modules"
                    value={`${design.moduleCount}× ${design.moduleBrand} ${design.moduleWattPeak} Wp`}
                    highlight={`${design.totalKwp.toFixed(1)} kWp`}
                  />
                  <SummaryRow icon="⚡" label="Inverter" value={design.inverterModel} />
                  {design.batteryCapacityKwh && (
                    <SummaryRow
                      icon="🔋"
                      label="Battery"
                      value={`${design.batteryCapacityKwh.toFixed(1)} kWh`}
                    />
                  )}
                  {design.heatPumpModel && (
                    <SummaryRow icon="🔥" label="Heat pump" value={design.heatPumpModel} />
                  )}
                  <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3">
                    <span className="text-sm font-semibold text-zinc-700">Total investment</span>
                    <div className="text-right">
                      <div className="text-lg font-bold text-zinc-900">
                        €{design.totalPriceEur.toLocaleString()}
                      </div>
                      <div className="text-xs text-emerald-600">
                        Payback {design.paybackYears.toFixed(1)} yrs · CO₂ {design.co2SavedTonsPer25y.toFixed(1)} t
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Checklist */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Pre-flight checklist
                </h3>
                <div className="space-y-2">
                  {CHECKLIST.map((item, i) => (
                    <ChecklistRow
                      key={item}
                      label={item}
                      checked={checks[i]}
                      onToggle={() =>
                        setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
                      }
                      disabled={exporting}
                    />
                  ))}
                </div>
              </section>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/60 px-7 py-4">
              <button
                onClick={() => setPhase('interactive')}
                disabled={exporting}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                Adjust design
              </button>
              <button
                onClick={handleApprove}
                disabled={exporting}
                className="group flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-70"
              >
                {exporting ? (
                  <>
                    <Spinner /> Generating PDF…
                  </>
                ) : (
                  <>
                    Approve &amp; export PDF
                    <svg className="h-4 w-4 transition group-hover:translate-y-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-zinc-500">
        <span className="text-base leading-none">{icon}</span>
        {label}
      </span>
      <span className="text-right font-medium text-zinc-900">
        {value}
        {highlight && (
          <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
            {highlight}
          </span>
        )}
      </span>
    </div>
  );
}

function ChecklistRow({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
        checked
          ? 'border-emerald-200 bg-emerald-50 text-zinc-900'
          : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
      } disabled:cursor-not-allowed`}
    >
      <span
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition ${
          checked ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-300 bg-white'
        }`}
      >
        <AnimatePresence>
          {checked && (
            <motion.svg
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-3 w-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </motion.svg>
          )}
        </AnimatePresence>
      </span>
      {label}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
