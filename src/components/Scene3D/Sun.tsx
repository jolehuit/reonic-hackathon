// Sun directional light driven by suncalc — OWNED by Dev A
'use client';

import { useRef } from 'react';
import { DirectionalLight } from 'three';
// import SunCalc from 'suncalc';

export function Sun() {
  const ref = useRef<DirectionalLight>(null);

  // TODO Dev A:
  // - useFrame to animate sun position over 12s during agent run
  // - SunCalc.getPosition(date, lat, lng) → azimut/altitude → directional vector
  // - shadow-mapSize 2048, shadow-bias -0.0005

  return (
    <directionalLight
      ref={ref}
      position={[20, 30, 10]}
      intensity={3}
      castShadow
      shadow-mapSize={[2048, 2048]}
    />
  );
}
