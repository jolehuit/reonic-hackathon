'use client';

import { useEffect, useRef } from 'react';
import { useStore, type HeatingFamily } from '@/lib/store';
import type { CustomerProfile, HouseId } from '@/lib/types';
import { CustomAddressForm } from './CustomAddressForm';

const HOUSE_PROFILES: Record<HouseId, CustomerProfile> = {
  brandenburg: {
    annualConsumptionKwh: 4500,
    inhabitants: 3,
    hasEv: true,
    evAnnualKm: 15000,
    heatingType: 'gas',
    houseSizeSqm: 140,
  },
  hamburg: {
    annualConsumptionKwh: 5200,
    inhabitants: 4,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 165,
  },
  ruhr: {
    annualConsumptionKwh: 6100,
    inhabitants: 5,
    hasEv: false,
    heatingType: 'oil',
    houseSizeSqm: 190,
  },
};

const HOUSE_LOCATION: Record<HouseId, string> = {
  brandenburg: '12 Lindenstraße, 14467 Brandenburg, Germany',
  hamburg: '8 Elbchaussee, 22587 Hamburg, Germany',
  ruhr: '5 Bochumer Straße, 44866 Bochum, Germany',
};

export function ProfileForm() {
  const phase = useStore((s) => s.phase);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const customAddress = useStore((s) => s.customAddress);
  const setPhase = useStore((s) => s.setPhase);

  const seededFor = useRef<string | null>(null);

  const isDemoHouse =
    selectedHouse === 'brandenburg' ||
    selectedHouse === 'hamburg' ||
    selectedHouse === 'ruhr';

  // Demo houses: seed the manual inputs from HOUSE_PROFILES so the same
  // CustomAddressForm renders pre-filled and the user only reviews/picks
  // a PV package.
  useEffect(() => {
    if (!selectedHouse || !isDemoHouse) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === selectedHouse) return;
    seededFor.current = selectedHouse;

    const target = HOUSE_PROFILES[selectedHouse as HouseId];
    const heatingFamily: HeatingFamily =
      target.heatingType === 'heatpump' ? 'renewable' : 'conventional';

    const update = useStore.getState().updateManualInput;
    const save = useStore.getState().saveManualSection;
    update('consumptionKwh', target.annualConsumptionKwh);
    update('inhabitants', target.inhabitants);
    update('hasSolar', false);
    update('heatingFamily', heatingFamily);
    update('hasEv', target.hasEv);
    update('evAnnualKm', target.evAnnualKm ?? 15000);
    update('hasEvCharger', false);
    save('energy');
    save('solar');
    save('heating');
    save('ev');
    save('charger');
  }, [selectedHouse, isDemoHouse]);

  if (
    phase === 'idle' ||
    phase === 'agent-running' ||
    phase === 'interactive' ||
    phase === 'reviewing' ||
    phase === 'approved'
  )
    return null;
  if (!selectedHouse) return null;

  const address =
    selectedHouse === 'custom'
      ? customAddress?.formatted ?? ''
      : HOUSE_LOCATION[selectedHouse as HouseId];

  return (
    <CustomAddressForm
      address={address}
      onGenerate={() => setPhase('agent-running')}
    />
  );
}
