import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained .next/standalone bundle that
  // ships only the runtime files Next + our routes need — keeps the Docker
  // image we deploy to Cloud Run small (~500 MB instead of ~1.2 GB with the
  // full node_modules tree).
  output: 'standalone',
  turbopack: {},
};

export default nextConfig;
