// Demo house coordinates — OWNED by Dev A
// Eventually replaced by Dev D's address-to-latlng resolution. Hardcoded
// here so the vision pipeline can run end-to-end on the 3 demo addresses.

import type { HouseId } from '@/lib/types';

export interface HouseCoords {
  lat: number;
  lng: number;
  address: string;
}

export const HOUSE_COORDS: Record<HouseId, HouseCoords> = {
  brandenburg: {
    lat: 52.4530,
    lng: 13.2868,
    address: 'Thielallee 36, Berlin, Germany',
  },
  hamburg: {
    lat: 52.40826,
    lng: 12.96441,
    address: 'Test addr 2, Potsdam-Golm, Germany',
  },
  ruhr: {
    lat: 52.616457,
    lng: 13.485022,
    address: 'Schönerlinder Weg 83, Berlin Karow, Germany',
  },
};
