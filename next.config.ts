import type { NextConfig } from "next";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Mirror CesiumJS build output to /public/cesium so Workers/Assets/Widgets are
// served at runtime. Idempotent (skips if Workers + Assets already present).
function ensureCesiumAssets(): void {
  try {
    const src = resolve(process.cwd(), "node_modules/cesium/Build/Cesium");
    const dst = resolve(process.cwd(), "public/cesium");
    if (!existsSync(src)) return;
    if (existsSync(resolve(dst, "Workers")) && existsSync(resolve(dst, "Assets"))) return;
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = resolve(src, entry.name);
      const to = resolve(dst, entry.name);
      if (entry.isDirectory()) cpSync(from, to, { recursive: true });
      else copyFileSync(from, to);
    }
  } catch {
    /* ignore */
  }
}
ensureCesiumAssets();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_CESIUM_BASE_URL: "/cesium" },
  turbopack: {},
};

export default nextConfig;
