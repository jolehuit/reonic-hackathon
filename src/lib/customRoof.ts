// Default profile for custom addresses when the user hasn't filled the
// manual form yet. Replaces the older `inferProfileFromLocation` which
// claimed to use lat/lng but actually ignored both — the underscored
// parameters were a giveaway. Now we just export an honest default.
//
// `synthesiseRoofGeometry` used to live here too. It produced a single
// gable house from `houseSizeSqm` alone (35° pitch, fixed sud 195°
// azimuth, naive grid of panels), and ignored lat/lng entirely. With the
// live geometry pipeline (Google 3D Tiles → Hunyuan/photogrammetry →
// analyze-multi) wired into /api/design, that synthesis is obsolete and
// has been removed — any GPS-coord request now returns real geometry.

import type { CustomerProfile } from './types';

/** Default customer profile (German residential median, Destatis 2024).
 *  Used to seed the autofill form before the user types anything. The
 *  k-NN engine still clusters against the 1620 Reonic deliveries, so
 *  this only changes which row of the dataset gets returned first. */
export function defaultCustomerProfile(): CustomerProfile {
  return {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: false,
    heatingType: 'gas',
    houseSizeSqm: 140,
    isJumelee: false,
  };
}
