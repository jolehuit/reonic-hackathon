import type { NextConfig } from "next";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Ensure CesiumJS static assets are available under /public/cesium so the
// browser can load Workers, Widgets, Assets, ThirdParty at runtime.
// Cesium ships its build output in node_modules/cesium/Build/Cesium; we mirror
// it the first time next.config is evaluated (cheap idempotent check).
function ensureCesiumAssets(): void {
  try {
    const src = resolve(process.cwd(), "node_modules/cesium/Build/Cesium");
    const dst = resolve(process.cwd(), "public/cesium");
    if (!existsSync(src)) return;
    if (existsSync(resolve(dst, "Workers")) && existsSync(resolve(dst, "Assets"))) {
      return;
    }
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = resolve(src, entry.name);
      const to = resolve(dst, entry.name);
      if (entry.isDirectory()) {
        cpSync(from, to, { recursive: true });
      } else {
        copyFileSync(from, to);
      }
    }
    // eslint-disable-next-line no-console
    console.log("[next.config] Mirrored CesiumJS assets to /public/cesium");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[next.config] Cesium asset mirror skipped:", err);
  }
}

ensureCesiumAssets();

const nextConfig: NextConfig = {
  // CesiumJS expects to load its workers/assets at runtime from a public path.
  // We expose the location via a public env var so the client component can
  // set window.CESIUM_BASE_URL before importing the library.
  env: {
    NEXT_PUBLIC_CESIUM_BASE_URL: "/cesium",
  },
  // Acknowledge Turbopack so the legacy webpack hook below is allowed to
  // coexist for production builds. Empty config = use defaults.
  turbopack: {},
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      http: false,
      https: false,
      zlib: false,
      url: false,
    };
    return config;
  },
};

export default nextConfig;
