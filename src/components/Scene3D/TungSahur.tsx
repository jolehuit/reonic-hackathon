// Tung Tung Tung Sahur — the wooden roof inspector with a baseball bat.
// Teleports on top of each solar panel at the exact moment it gets placed,
// swings his bat once, then dashes to the next position.
//
// Synchronisation: the orchestrator's drop loop bumps `placedCount` from 0
// up to design.moduleCount. Each tick triggers a fresh swing on whichever
// panel just landed. Once placedCount === total, Sahur fades out — phase
// becomes 'interactive' and the user takes over.

'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, Group, Vector3 } from 'three';
import { useStore } from '@/lib/store';
import { useEffectiveDesign } from '@/lib/useEffectiveDesign';
import { useHouseGeometry } from './HouseGeometry';

// Body height in meters. Real Sahur is approx. 1.6 m on the roof — big
// enough to read against the panels, small enough not to dominate.
const TARGET_SIZE = 1.6;
// How high above each panel's top face Sahur floats.
const HOVER_OFFSET = 0.85;
// Position lerp speed per frame (1 = teleport, 0 = never moves).
const LERP_SPEED = 0.22;
// Swing dynamics: damped sinusoid so the bat snaps down then settles.
const SWING_DAMPING = 7;        // higher = quicker decay
const SWING_FREQ = 28;          // rad/s
const SWING_AMPLITUDE = 0.7;    // peak rotation in radians

export function TungSahur() {
  const placedCount = useStore((s) => s.placedCount);
  const phase = useStore((s) => s.phase);
  const design = useEffectiveDesign();
  const { modulePositions } = useHouseGeometry();
  const { scene } = useGLTF('/models/sahur.glb');

  const cloned = useMemo(() => scene.clone(true), [scene]);
  const scale = useMemo(() => {
    const bbox = new Box3().setFromObject(cloned);
    const size = bbox.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    return longest > 0 ? TARGET_SIZE / longest : 1;
  }, [cloned]);

  // Cast shadows on the visible mesh tree once.
  useEffect(() => {
    cloned.traverse((o) => {
      if ('castShadow' in o) (o as { castShadow: boolean }).castShadow = true;
    });
  }, [cloned]);

  const positionRef = useRef<Group>(null);
  const swingRef = useRef<Group>(null);
  const swingStartRef = useRef<number>(0);

  // Whenever placedCount increments, restart the swing. Sahur arrives →
  // swings → panel lands.
  const [lastPlaced, setLastPlaced] = useState(0);
  useEffect(() => {
    if (placedCount !== lastPlaced) {
      setLastPlaced(placedCount);
      swingStartRef.current = performance.now();
    }
  }, [placedCount, lastPlaced]);

  // Effective panel target = the position we should be hovering over.
  // We snap to the LATEST placed index, capped at the array length.
  const target = useMemo(() => {
    if (!design) return null;
    if (modulePositions.length === 0) return null;
    if (placedCount === 0) return null;
    const idx = Math.min(placedCount - 1, modulePositions.length - 1);
    const p = modulePositions[idx];
    return new Vector3(p.x, p.y + HOVER_OFFSET, p.z);
  }, [placedCount, modulePositions, design]);

  // Visible only while panels are still landing, not after the user takes
  // control. Also skip if there's nothing to do.
  const animating =
    phase === 'agent-running' &&
    !!design &&
    modulePositions.length > 0 &&
    placedCount > 0 &&
    placedCount < modulePositions.length + 1;

  useFrame(() => {
    if (!positionRef.current || !target) return;
    positionRef.current.position.lerp(target, LERP_SPEED);

    if (swingRef.current) {
      const t = (performance.now() - swingStartRef.current) / 1000;
      // Damped oscillation around the X axis — looks like a downward
      // swing that bounces back.
      const swing =
        Math.exp(-t * SWING_DAMPING) * Math.sin(t * SWING_FREQ) * SWING_AMPLITUDE;
      swingRef.current.rotation.x = swing;
    }
  });

  if (!animating || !target) return null;

  return (
    <group ref={positionRef} position={target} scale={scale}>
      <group ref={swingRef}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

useGLTF.preload('/models/sahur.glb');
