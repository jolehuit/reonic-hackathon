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
    lat: 48.913527,
    lng: 2.5149273,
    address: '61 Bd Jean Moulin, 93190 Livry-Gargan, France',
  },
  hamburg: {
    lat: 53.5511,
    lng: 9.9937,
    address: 'Hamburg, Germany',
  },
  ruhr: {
    lat: 51.5135,
    lng: 7.4653,
    address: 'Essen, Ruhr, Germany',
  },
};
