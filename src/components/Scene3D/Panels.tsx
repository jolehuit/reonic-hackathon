// Solar panels — OWNED by Dev A
// Each module is rotated to match the normal of its host roof face so it
// sits flush on the slope (instead of lying flat parallel to the ground,
// which causes massive z-fighting against the tilted roof plane). A small
// offset along the face normal keeps the panel above the roof surface even
// when the analysis.json bake places the position right on the slope.

'use client';

import { useMemo } from 'react';
import { Quaternion, Vector3 } from 'three';
import { useStore } from '@/lib/store';
import { useHouseGeometry } from './HouseGeometry';
import { useSceneVision } from './vision/useSceneVision';
import { rescaleY } from './vision/scale';
import { DEFAULT_VISION_PARAMS } from './vision/visionTypes';

const PANEL_SIZE: [number, number, number] = [1.7, 0.04, 1.0];
const PANEL_LIFT_M = 0.04;
const PANEL_COLOR = '#1a3a6e';
const UP = new Vector3(0, 1, 0);

export function Panels() {
  const design = useStore((s) => s.design);
  const { faces } = useHouseGeometry();
  const { params: aiParams } = useSceneVision();
  // Match StylizedHouse: when Gemini hasn't responded, fall back to the same
  // defaults so panel positions land on the procedural roof, not inside it.
  const visionParams = aiParams ?? DEFAULT_VISION_PARAMS;

  const rotationByFaceId = useMemo(() => {
    const map = new Map<number, Quaternion>();
    for (const face of faces) {
      const n = new Vector3(face.normal[0], face.normal[1], face.normal[2]).normalize();
      const q = new Quaternion().setFromUnitVectors(UP, n);
      map.set(face.id, q);
    }
    return map;
  }, [faces]);

  const normalByFaceId = useMemo(() => {
    const map = new Map<number, [number, number, number]>();
    for (const face of faces) map.set(face.id, face.normal);
    return map;
  }, [faces]);

  if (!design || design.modulePositions.length === 0) return null;

  return (
    <group>
      {design.modulePositions.map((p, i) => {
        const q = rotationByFaceId.get(p.faceId);
        const n = normalByFaceId.get(p.faceId) ?? [0, 1, 0];
        // Rescale the panel's Y to match the AI-driven effective wall height
        // (analysis.json was baked at 3 m, StylizedHouse may render at 5.4 m+).
        const scaledY = rescaleY(p.y, visionParams);
        const lx = p.x + n[0] * PANEL_LIFT_M;
        const ly = scaledY + n[1] * PANEL_LIFT_M;
        const lz = p.z + n[2] * PANEL_LIFT_M;

        return (
          <mesh key={i} position={[lx, ly, lz]} quaternion={q} castShadow>
            <boxGeometry args={PANEL_SIZE} />
            <meshToonMaterial color={PANEL_COLOR} />
          </mesh>
        );
      })}
    </group>
  );
}
