'use client';

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
  houseId,
  latOverride,
  lngOverride,
}: ViewerSlotProps) {
  const fallback = HOUSE_COORDS[houseId as HouseId] ?? HOUSE_COORDS.brandenburg;
  const lat = latOverride ?? fallback.lat;
  const lng = lngOverride ?? fallback.lng;
  const src = `/api/aerial?lat=${lat}&lng=${lng}&zoom=20`;

  return (
    <div data-testid="viewer-slot" className="absolute inset-0 flex items-center justify-center bg-white">
      <img
        src={src}
        alt={`Top-down satellite at ${lat}, ${lng}`}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
