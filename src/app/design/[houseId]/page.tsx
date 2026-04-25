// Design page — minimal viewer: only the Google 3D Tiles for the address,
// no panels, no consumption, no sidebars.

'use client';

import { use } from 'react';
import { Scene3D } from '@/components/Scene3D/Scene3D';
import type { HouseId } from '@/lib/types';

interface Props {
  params: Promise<{ houseId: HouseId }>;
}

export default function DesignPage({ params }: Props) {
  const { houseId } = use(params);
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      <div className="absolute inset-0">
        <Scene3D houseId={houseId} />
      </div>
    </main>
  );
}
