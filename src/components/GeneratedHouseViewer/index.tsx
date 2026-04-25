'use client';

import dynamic from 'next/dynamic';

export const GeneratedHouseViewer = dynamic(
  () => import('./GeneratedHouseViewer').then((m) => m.GeneratedHouseViewer),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-gray-400">
        Loading generated 3D model…
      </div>
    ),
  },
);
