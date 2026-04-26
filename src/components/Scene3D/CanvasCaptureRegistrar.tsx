// Registers a snapshot function in the Zustand store so the approval
// modal can grab a PNG of the current 3D frame at the moment the user
// clicks "Approve". Mounted inside <Canvas> so useThree resolves to the
// active gl/scene/camera. Without this, the export PDF ships without
// the canvas screenshot.
//
// We render-then-read inside a single synchronous task so we don't need
// the canvas to be created with preserveDrawingBuffer: true (which has
// a perf cost). Three's render() writes to the framebuffer; toDataURL()
// reads it back before the next compositor swap clears it.

'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';

export function CanvasCaptureRegistrar() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const setCaptureSnapshot = useStore((s) => s.setCaptureSnapshot);

  useEffect(() => {
    const capture = (): string | null => {
      try {
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    };
    setCaptureSnapshot(capture);
    return () => setCaptureSnapshot(null);
  }, [gl, scene, camera, setCaptureSnapshot]);

  return null;
}
