// Demo-house metadata — single source of truth.
//
// Three demo addresses (brandenburg / hamburg / ruhr) drive the autofill
// flow. Each one carries (a) a default customer profile that the autofill
// typewriter reveals, and (b) a human-readable address string used by the
// KPI sidebar, the approval modal and the PDF.
//
// Before this file existed, the same data lived simultaneously in three
// places (ProfileForm.HOUSE_PROFILES, dev-mocks.MOCK_PROFILES, and an
// orphan public/baked/house-profiles.json that no code actually read).
// Values had already drifted apart — ruhr was `isJumelee: true` in the
// JSON but `false` in the form, leading to silent /2 plafonds on the
// roof capacity if the JSON had ever been wired in.

import type { CustomerProfile, HouseId } from './types';

export const HOUSE_PROFILES: Record<HouseId, CustomerProfile> = {
  brandenburg: {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: true,
    evAnnualKm: 15000,
    heatingType: 'gas',
    houseSizeSqm: 140,
    isJumelee: false,
  },
  hamburg: {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
    isJumelee: false,
  },
  ruhr: {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
    isJumelee: false,
  },
};

export const HOUSE_LOCATION: Record<HouseId, string> = {
  brandenburg: 'Thielallee 36, Berlin, Germany',
  hamburg: 'Test addr 2, Potsdam-Golm, Germany',
  ruhr: 'Schönerlinder Weg 83, Berlin Karow, Germany',
};
