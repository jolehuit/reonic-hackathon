// Public wrapper around the Cesium-backed scene — OWNED by Dev A
// Sets `window.CESIUM_BASE_URL` BEFORE the heavy CesiumScene module is
// imported, so the workers/widgets/assets resolve from /public/cesium.
//
// Cesium itself only runs in the browser (uses `window`, `WebGL2`, web
// workers); we therefore lazy-load the scene with `next/dynamic`.

"use client";

import dynamic from "next/dynamic";
import { useMemo, type CSSProperties } from "react";
import type { CesiumSceneProps, CesiumViewerMode } from "./CesiumScene";

if (typeof window !== "undefined") {
  // Cesium reads window.CESIUM_BASE_URL once during its first import to
  // resolve workers/widgets/assets at runtime. Setting it here (before
  // dynamic import resolves) avoids a network 404 storm.
  const w = window as Window & { CESIUM_BASE_URL?: string };
  if (!w.CESIUM_BASE_URL) {
    w.CESIUM_BASE_URL =
      process.env.NEXT_PUBLIC_CESIUM_BASE_URL ?? "/cesium";
  }
}

const CesiumSceneLazy = dynamic(
  () => import("./CesiumScene").then((m) => m.CesiumScene),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        Loading 3D viewer…
      </div>
    ),
  },
);

export type { CesiumViewerMode, CesiumSceneProps as CesiumViewerProps };

export interface CesiumViewerComponentProps {
  lat: number;
  lng: number;
  mode?: CesiumViewerMode;
  heading?: number;
  clipRadiusM?: number;
  onCompassChange?: (heading: number) => void;
  className?: string;
  style?: CSSProperties;
}

export function CesiumViewer(props: CesiumViewerComponentProps) {
  // Default styling: full-screen friendly. Caller can layer with `inset-0`.
  const style = useMemo<CSSProperties>(
    () => ({
      width: "100%",
      height: "100%",
      background: "#ffffff",
      ...props.style,
    }),
    [props.style],
  );
  return <CesiumSceneLazy {...props} style={style} />;
}
