// Cinematic camera rig — OWNED by Dev A
// Phase 1 (agent-running): GSAP aerial dive 0→2s, settle 2→3s.
// Phase 2 (panelFocus published): pivot to face the populated roof so
//                                 the user sees the panels head-on.
'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '@/lib/store';
import gsap from 'gsap';

const FOCUS_DISTANCE_M = 18;   // along the roof normal away from the centroid
const FOCUS_HEIGHT_BIAS = 4;   // extra Y so we look slightly down on the array

export function CameraRig() {
  const { camera } = useThree();
  const phase = useStore((s) => s.phase);
  const panelFocus = useStore((s) => s.panelFocus);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (phase !== 'agent-running') return;

    const tl = gsap.timeline();
    tlRef.current = tl;

    // Aerial dive
    tl.fromTo(
      camera.position,
      { x: 80, y: 60, z: 80 },
      { x: 30, y: 25, z: 30, duration: 2, ease: 'power3.out', onUpdate: () => camera.lookAt(0, 0, 0) },
    );
    // Settle
    tl.to(camera.position, {
      x: 25, y: 18, z: 25, duration: 1, ease: 'power2.inOut',
      onUpdate: () => camera.lookAt(0, 2, 0),
    });

    return () => {
      tl.kill();
    };
  }, [phase, camera]);

  // Once the panel layout publishes its focus, tween the camera to look
  // at the centroid from the direction the panels face. We project the
  // dominant normal onto the ground plane to keep the camera at a
  // grounded angle (otherwise vertical pitches would push us straight up).
  useEffect(() => {
    if (!panelFocus) return;
    const [cx, cy, cz] = panelFocus.center;
    const [nx, , nz] = panelFocus.normal;
    const horizontal = new Vector3(nx, 0, nz);
    if (horizontal.lengthSq() < 1e-4) horizontal.set(0, 0, 1);
    horizontal.normalize();
    const targetX = cx + horizontal.x * FOCUS_DISTANCE_M;
    const targetY = cy + FOCUS_HEIGHT_BIAS;
    const targetZ = cz + horizontal.z * FOCUS_DISTANCE_M;

    // Kill any previous tween so the focus pivot can override the dive.
    tlRef.current?.kill();
    const tl = gsap.timeline();
    tlRef.current = tl;
    tl.to(camera.position, {
      x: targetX,
      y: targetY,
      z: targetZ,
      duration: 1.4,
      ease: 'power2.inOut',
      onUpdate: () => camera.lookAt(cx, cy, cz),
    });

    return () => {
      tl.kill();
    };
  }, [panelFocus, camera]);

  return null;
}
