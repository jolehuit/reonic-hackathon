// House GLB loader — OWNED by Dev A
'use client';

import { useGLTF } from '@react-three/drei';
import type { HouseId } from '@/lib/types';

const PATHS: Record<HouseId, string> = {
  brandenburg: '/models/brandenburg.glb',
  hamburg: '/models/hamburg.glb',
  ruhr: '/models/ruhr.glb',
};

interface Props {
  houseId: HouseId;
}

export function House({ houseId }: Props) {
  const { scene } = useGLTF(PATHS[houseId]);
  return <primitive object={scene} />;
}

// Preload all houses for smoother demo transitions
Object.values(PATHS).forEach((p) => useGLTF.preload(p));
