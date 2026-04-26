import type { NextConfig } from "next";

// CSP — strict by default but with the explicit allowlist for the domains
// our flow actually hits:
//  • Google Maps + 3D Tiles (Cesium runtime + tile fetches)
//  • fal.media / fal.ai (cleaned image + GLB hosting)
//  • Tavily (PDF "incentives" lookup)
//  • Google Generative Language (Gemini PDF report)
// 'unsafe-inline' on scripts/styles is required by Next/Turbopack's inline
// hydration boot scripts. 'unsafe-eval' is required by react-three-fiber's
// shader compilation. Tightening this further would need a per-request
// nonce middleware, out of scope for the hackathon.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.fal.media https://*.fal.ai https://*.googleusercontent.com",
  "connect-src 'self' https://*.googleapis.com https://maps.gstatic.com https://*.fal.media https://*.fal.ai https://generativelanguage.googleapis.com https://api.tavily.com https://tile.googleapis.com",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  // CSP — locks down which origins can be fetched / executed. See above.
  { key: 'Content-Security-Policy', value: CSP },
  // HSTS — forces HTTPS for a year. preload eligible.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  // Defense in depth against clickjacking — frame-ancestors 'none' in CSP
  // already blocks framing on browsers that respect CSP, this catches the
  // legacy ones.
  { key: 'X-Frame-Options', value: 'DENY' },
  // MIME-sniffing nope.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer leak: send origin only on cross-origin nav.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Permissions-Policy: deny everything we don't use.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained .next/standalone bundle that
  // ships only the runtime files Next + our routes need — keeps the Docker
  // image we deploy to Cloud Run small (~500 MB instead of ~1.2 GB with the
  // full node_modules tree).
  output: 'standalone',
  turbopack: {},
  // Aikido flagged "Server leaks info via 'X-Powered-By'". Drop it.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
