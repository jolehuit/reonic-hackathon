// Cinematic camera rig — OWNED by Dev A
// GSAP timeline: aerial dive 0→2s, settle 2→3s, idle slow orbit 3s+.
'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from '@/lib/store';
import gsap from 'gsap';

export function CameraRig() {
  const { camera } = useThree();
  const phase = useStore((s) => s.phase);
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

  return null;
}
