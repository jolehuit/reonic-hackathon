'use client';

// useEffectiveDesign — single source of truth for everything the user sees.
//
// /api/design returns ONE snapshot computed from k-NN + the customer profile
// + the baked roof geometry. After that, the user can:
//   • toggle Battery / HeatPump / Wallbox in <ControlPanel/>
//   • drag the consumption slider
//   • edit the panel layout (add / remove / drag) which mutates
//     `editedPanels.length`
//   • change electricityPrice in the manual-address form
//
// All of these CHANGE the system specs but were not feeding back into the
// financials before. So the sidebar / modal / PDF could show
// "7 modules · 9.2 kWp · €8 800" even after the user removed half the panels.
//
// This hook recomputes a fresh DesignResult on every change by re-running
// computeFinancials() with the new effective inputs. It is pure / cheap
// (sub-millisecond) so we don't bother debouncing.
//
// When the user enables a component (Battery / HeatPump / Wallbox), the
// hook honours the toggle even if k-NN didn't recommend it for this
// profile — falling back to a sensible default size — so the toggle
// always feels alive (3D model appears, price line item appears). When
// the user disables, the value goes to null.

import { useMemo } from 'react';
import { computeFinancials } from './financials';
import type { DesignResult } from './types';
import { useStore } from './store';

// Defaults used when the user toggles a component on but k-NN didn't
// recommend it. Picked from the median residential offer.
const DEFAULT_BATTERY_KWH = 5;
const DEFAULT_HEATPUMP_KW = 8;
const DEFAULT_HEATPUMP_MODEL = 'Viessmann Vitocal 250-A';

export function useEffectiveDesign(): DesignResult | null {
  const design = useStore((s) => s.design);
  const editedPanels = useStore((s) => s.editedPanels);
  const refinements = useStore((s) => s.refinements);
  const profile = useStore((s) => s.profile);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const electricityPrice = useStore((s) => s.manualInputs.electricityPrice);

  return useMemo(() => {
    if (!design || !profile) return design;

    // 1. Module count: user's manual edit (if any) overrides the k-NN-sized
    //    count. effectiveModuleCount drives BOTH what's displayed and what
    //    the financials are computed against.
    const effectiveModuleCount = editedPanels?.length ?? design.moduleCount;
    const effectiveTotalKwp =
      Math.round((effectiveModuleCount * design.moduleWattPeak) / 1000 * 100) / 100;

    // 2. Composition toggles. Toggle ON → use k-NN's size if k-NN
    //    recommended one, otherwise fall back to a sensible default so
    //    the 3D component + price line item still appear. Toggle OFF
    //    → null.
    const effectiveBatteryKwh = refinements.includeBattery
      ? design.batteryCapacityKwh ?? DEFAULT_BATTERY_KWH
      : null;
    const effectiveHeatPumpKw = refinements.includeHeatPump
      ? design.heatPumpNominalPowerKw ?? DEFAULT_HEATPUMP_KW
      : null;
    const effectiveHeatPumpModel = effectiveHeatPumpKw
      ? design.heatPumpModel ?? DEFAULT_HEATPUMP_MODEL
      : null;
    const effectiveHasWallbox = refinements.includeWallbox;

    // 3. Tariff override: only the manual-address flow exposes a custom
    //    electricity price (cents/kWh). For demo houses, the EEG default
    //    constants in financials.ts apply.
    const overrides =
      selectedHouse === 'custom' && electricityPrice > 0
        ? { retailPrice: electricityPrice / 100 }
        : undefined;

    const fin = computeFinancials({
      totalKwp: effectiveTotalKwp,
      batteryKwh: effectiveBatteryKwh,
      heatPumpKw: effectiveHeatPumpKw,
      hasWallbox: effectiveHasWallbox,
      annualConsumptionKwh: profile.annualConsumptionKwh,
      hasEv: profile.hasEv,
      overrides,
    });

    // 4. Inverter resizes with effectiveTotalKwp (industry rule: ~85 % AC
    //    sizing). Same formula /api/design uses, kept consistent here so
    //    the modal/sidebar/PDF agree even after edits.
    const inverterPowerKw = Math.max(1, Math.ceil(effectiveTotalKwp * 0.85));
    const inverterLoadPercent =
      effectiveTotalKwp > 0
        ? Math.round((effectiveTotalKwp / inverterPowerKw) * 100)
        : 0;

    return {
      ...design,
      moduleCount: effectiveModuleCount,
      totalKwp: effectiveTotalKwp,
      batteryCapacityKwh: effectiveBatteryKwh,
      heatPumpNominalPowerKw: effectiveHeatPumpKw,
      heatPumpModel: effectiveHeatPumpModel,
      wallboxChargeSpeedKw: effectiveHasWallbox ? 11 : null,
      inverterPowerKw,
      inverterLoadPercent,
      totalPriceEur: fin.totalPriceEur,
      paybackYears: fin.paybackYears,
      co2SavedTonsPer25y: fin.co2SavedTonsPer25y,
      selfConsumptionRatio: fin.selfConsumptionRatio,
    };
  }, [design, editedPanels, refinements, profile, selectedHouse, electricityPrice]);
}
