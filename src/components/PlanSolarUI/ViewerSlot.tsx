'use client';

import { CesiumViewer } from '@/components/CesiumViewer';
import { HOUSE_COORDS } from '@/components/Scene3D/vision/houseLatLng';
import type { HouseId } from '@/lib/types';
import type { SourceId, ViewMode } from './types';

interface ViewerSlotProps {
  viewMode: ViewMode;
  source: SourceId;
  heading: number;
  houseId: string;
  latOverride?: number | null;
  lngOverride?: number | null;
  radiusOverride?: number | null;
}

export function ViewerSlot({
  viewMode,
  heading,
  houseId,
  latOverride,
  lngOverride,
  radiusOverride,
}: ViewerSlotProps) {
  const fallback = HOUSE_COORDS[houseId as HouseId] ?? HOUSE_COORDS.brandenburg;
  const lat = latOverride ?? fallback.lat;
  const lng = lngOverride ?? fallback.lng;
  const radius = radiusOverride ?? 30;

  return (
    <div
      data-testid="viewer-slot"
      className="absolute inset-0 bg-white"
    >
      <div
        className="absolute inset-0"
        style={{
          clipPath: 'polygon(50% 6%, 94% 50%, 50% 94%, 6% 50%)',
        }}
      >
        <CesiumViewer
          lat={lat}
          lng={lng}
          mode={viewMode}
          heading={heading}
          clipRadiusM={radius}
        />
      </div>
    </div>
  );
}
