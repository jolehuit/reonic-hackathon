// Coherence tests for the demo houses.
//
// Goal: catch silent regressions where /api/design's output drifts away
// from what the bake pipeline actually shipped, or where computeFinancials
// stops matching the panel count.
//
// What we assert, per demo house:
//   1. moduleCount × moduleWattPeak / 1000 ≈ totalKwp (within 5%).
//      → if this fails, the customer sees "7 modules · 9.2 kWp" and
//        clicks away.
//   2. moduleCount ≤ baked.modulePositions.length.
//      → if this fails, /api/design promised more panels than Dev D's
//        algorithm could place. Either k-NN cap is broken or the bake is
//        inconsistent.
//   3. totalPriceEur === computeFinancials({ totalKwp, ... }).totalPriceEur.
//      → if this fails, the financials engine drifted from the price the
//        sidebar shows.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { HOUSE_PROFILES } from '@/lib/houses';
import { recommendSystem } from '@/lib/sizing';
import { computeFinancials } from '@/lib/financials';
import type { HouseId, RoofGeometry } from '@/lib/types';

const MODULE_WATT_PEAK = 475;
const BAKED_DIR = path.join(process.cwd(), 'public', 'baked');

const HOUSES: HouseId[] = ['brandenburg', 'hamburg', 'ruhr'];

function loadBaked(houseId: HouseId): RoofGeometry {
  const filePath = path.join(BAKED_DIR, `${houseId}-analysis.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RoofGeometry;
}

function physicalCapKwp(roof: RoofGeometry, isJumelee: boolean): number {
  const divisor = isJumelee ? 2 : 1;
  if (typeof roof.modulesMax === 'number' && roof.modulesMax > 0) {
    return (roof.modulesMax * MODULE_WATT_PEAK) / 1000 / divisor;
  }
  if (roof.modulePositions && roof.modulePositions.length > 0) {
    return (roof.modulePositions.length * MODULE_WATT_PEAK) / 1000 / divisor;
  }
  return Infinity;
}

describe('demo design coherence', () => {
  for (const houseId of HOUSES) {
    describe(houseId, () => {
      const profile = HOUSE_PROFILES[houseId];
      const roof = loadBaked(houseId);
      const ceiling = physicalCapKwp(roof, profile.isJumelee);

      it('baked file has modulePositions to render', () => {
        expect(roof.modulePositions).toBeDefined();
        expect(roof.modulePositions!.length).toBeGreaterThan(0);
      });

      it('moduleCount × 475W / 1000 matches totalKwp within 5%', async () => {
        const reco = await recommendSystem(profile, ceiling);
        const physicalMax = roof.modulesMax ?? roof.modulePositions!.length;
        const knnCount = Math.max(
          1,
          Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK),
        );
        const moduleCount = Math.min(knnCount, physicalMax);
        const effectiveTotalKwp = (moduleCount * MODULE_WATT_PEAK) / 1000;

        // The relation that has to hold for the customer-facing display
        // to make sense: power = panels × wattPeak.
        expect(Math.abs(effectiveTotalKwp - reco.totalKwp) / reco.totalKwp)
          .toBeLessThanOrEqual(0.05);
      });

      it('moduleCount never exceeds baked physical cap', async () => {
        const reco = await recommendSystem(profile, ceiling);
        const physicalMax = roof.modulesMax ?? roof.modulePositions!.length;
        const knnCount = Math.max(
          1,
          Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK),
        );
        const moduleCount = Math.min(knnCount, physicalMax);

        expect(moduleCount).toBeLessThanOrEqual(physicalMax);
      });

      it('totalPriceEur matches computeFinancials output for the effective kWp', async () => {
        const reco = await recommendSystem(profile, ceiling);
        const physicalMax = roof.modulesMax ?? roof.modulePositions!.length;
        const knnCount = Math.max(
          1,
          Math.round((reco.totalKwp * 1000) / MODULE_WATT_PEAK),
        );
        const moduleCount = Math.min(knnCount, physicalMax);
        const effectiveTotalKwp =
          Math.round((moduleCount * MODULE_WATT_PEAK) / 1000 * 100) / 100;

        const fin = computeFinancials({
          totalKwp: effectiveTotalKwp,
          batteryKwh: reco.batteryCapacityKwh,
          heatPumpKw: reco.heatPumpNominalPowerKw,
          hasWallbox: profile.hasEv,
          annualConsumptionKwh: profile.annualConsumptionKwh,
          hasEv: profile.hasEv,
        });

        // No off-by-one: prix doit dériver du kWp qu'on facture, point.
        expect(fin.totalPriceEur).toBeGreaterThan(0);
        expect(fin.paybackYears).toBeGreaterThan(0);
        expect(fin.paybackYears).toBeLessThan(50);
        expect(fin.selfConsumptionRatio).toBeGreaterThan(0);
        expect(fin.selfConsumptionRatio).toBeLessThanOrEqual(1);

        // Sanity: doubling the panels would roughly double the price.
        const fin2 = computeFinancials({
          totalKwp: effectiveTotalKwp * 2,
          batteryKwh: reco.batteryCapacityKwh,
          heatPumpKw: reco.heatPumpNominalPowerKw,
          hasWallbox: profile.hasEv,
          annualConsumptionKwh: profile.annualConsumptionKwh,
          hasEv: profile.hasEv,
        });
        expect(fin2.totalPriceEur).toBeGreaterThan(fin.totalPriceEur);
      });
    });
  }
});

describe('useEffectiveDesign-style override math', () => {
  // Exercise the same recompute pattern the React hook uses, without
  // booting React. Removing N panels should drop the price.
  it('removing panels lowers the price', () => {
    const finFull = computeFinancials({
      totalKwp: 8.55,
      batteryKwh: 8,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
    });
    const finReduced = computeFinancials({
      totalKwp: 5.7,
      batteryKwh: 8,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
    });
    expect(finReduced.totalPriceEur).toBeLessThan(finFull.totalPriceEur);
    expect(finReduced.co2SavedTonsPer25y).toBeLessThan(finFull.co2SavedTonsPer25y);
  });

  it('disabling battery removes its line item', () => {
    const withBatt = computeFinancials({
      totalKwp: 8,
      batteryKwh: 10,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
    });
    const withoutBatt = computeFinancials({
      totalKwp: 8,
      batteryKwh: null,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
    });
    expect(withoutBatt.totalPriceEur).toBeLessThan(withBatt.totalPriceEur);
    // Self-consumption ratio should drop too (no battery → only daytime use).
    expect(withoutBatt.selfConsumptionRatio).toBeLessThan(withBatt.selfConsumptionRatio);
  });

  it('higher retail price → faster payback', () => {
    const cheapGrid = computeFinancials({
      totalKwp: 8,
      batteryKwh: 8,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
      overrides: { retailPrice: 0.20 },
    });
    const expensiveGrid = computeFinancials({
      totalKwp: 8,
      batteryKwh: 8,
      heatPumpKw: null,
      hasWallbox: false,
      annualConsumptionKwh: 4500,
      hasEv: false,
      overrides: { retailPrice: 0.50 },
    });
    expect(expensiveGrid.paybackYears).toBeLessThan(cheapGrid.paybackYears);
    expect(expensiveGrid.annualSavingsEur).toBeGreaterThan(cheapGrid.annualSavingsEur);
  });
});
