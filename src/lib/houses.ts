// Demo-house metadata — single source of truth.
//
// Three demo addresses drive the autofill flow. Each one carries
// (a) a default customer profile that the autofill typewriter reveals,
// (b) lat/lng for the bake pipeline,
// (c) a human-readable address string used by the KPI sidebar, the
//     approval modal and the PDF.
//
// IDs are slug-style names of the actual neighbourhood each address sits
// in (formerly `brandenburg / hamburg / ruhr`, which were misleading —
// brandenburg's address is in Berlin-Dahlem, hamburg's in Potsdam-Golm,
// ruhr's in Berlin-Karow).

import type { CustomerProfile, HouseId } from './types';

export const HOUSE_PROFILES: Record<HouseId, CustomerProfile> = {
  'berlin-dahlem': {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: true,
    evAnnualKm: 15000,
    heatingType: 'gas',
    houseSizeSqm: 140,
    isJumelee: false,
  },
  'potsdam-golm': {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
    isJumelee: false,
  },
  'berlin-karow': {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
    isJumelee: false,
  },
};

export const HOUSE_COORDS: Record<HouseId, { lat: number; lng: number }> = {
  'berlin-dahlem': { lat: 52.4530, lng: 13.2868 },
  'potsdam-golm': { lat: 52.408257, lng: 12.964409 },
  'berlin-karow': { lat: 52.616457, lng: 13.485022 },
};

export const HOUSE_LOCATION: Record<HouseId, string> = {
  'berlin-dahlem': 'Thielallee 36, Berlin, Germany',
  'potsdam-golm': 'Potsdam-Golm, Germany',
  'berlin-karow': 'Schönerlinder Weg 83, Berlin Karow, Germany',
};
