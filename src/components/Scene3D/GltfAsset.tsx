// Generic GLB loader for the energy components in the scene (Battery,
// HeatPump, Wallbox, EV). Loads via drei's useGLTF (which caches parsing
// across mounts), clones the scene so multiple instances don't share
// transforms, then scales the cloned root so its longest axis matches the
// supplied real-world dimension. Caller positions the resulting <group>
// however they want.
//
// `targetSize` is the real-world dimension in meters along whichever axis
// is dominant in the GLB. We pick the longest of (width, height, depth)
// so the same prop works regardless of how the modeller oriented the
// asset.

'use client';

import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Box3, Vector3 } from 'three';

interface GltfAssetProps {
  url: string;
  /** Target real-world dimension in meters along the asset's longest axis. */
  targetSize: number;
  /** Whether the asset should cast shadows (default: true). */
  castShadow?: boolean;
  /** Whether the asset should receive shadows (default: true for floor-standing assets). */
  receiveShadow?: boolean;
}

export function GltfAsset({
  url,
  targetSize,
  castShadow = true,
  receiveShadow = true,
}: GltfAssetProps) {
  const { scene } = useGLTF(url);

  const { object, scale, yOffset } = useMemo(() => {
    const cloned = scene.clone(true);
    const bbox = new Box3().setFromObject(cloned);
    const size = bbox.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    const s = longest > 0 ? targetSize / longest : 1;

    // Recenter on XZ so the asset's footprint is at (0, 0). Y offset
    // pushes the bottom of the bbox to y=0 so callers can position by
    // the floor level.
    const center = bbox.getCenter(new Vector3());
    cloned.position.set(-center.x, -bbox.min.y, -center.z);

    cloned.traverse((o) => {
      // Three's Mesh has these flags but the type is loose — feature-detect.
      if ('castShadow' in o) (o as { castShadow: boolean }).castShadow = castShadow;
      if ('receiveShadow' in o) (o as { receiveShadow: boolean }).receiveShadow = receiveShadow;
    });

    return { object: cloned, scale: s, yOffset: 0 };
  }, [scene, targetSize, castShadow, receiveShadow]);

  return (
    <group scale={scale} position={[0, yOffset, 0]}>
      <primitive object={object} />
    </group>
  );
}

// Preload all assets used in the live scene so the first paint doesn't
// stall on a fresh fetch — drei caches the parsed scene by URL.
useGLTF.preload('/models/tesla-powerwall.glb');
useGLTF.preload('/models/panasonic-heatpump.glb');
useGLTF.preload('/models/tesla-model-3.glb');
