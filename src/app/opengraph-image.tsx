// Dynamically-rendered Open Graph image, served at /opengraph-image
// (Next.js App Router convention). Sized 1200×630 — the canonical aspect
// ratio for Twitter / Slack / LinkedIn / Discord previews. Reuses the same
// 4-color arc from the favicon as the brand element so the share card and
// the favicon stay visually coherent.

import { ImageResponse } from "next/og";

// nodejs runtime so we ride on the existing Cloud Run container — no need
// for an edge-runtime fallback in our deployment topology.
export const runtime = "nodejs";
export const alt = "Iconic — From an address to a complete solar design in 30 seconds.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(135deg, #ffffff 0%, #f8fafc 50%, #eef2f7 100%)",
          padding: "72px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Brand mark — 4 colored arcs + "Iconic" wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          {/* Inline SVG of the 4-arc mark from icon.svg, scaled up. */}
          <svg width="76" height="84" viewBox="0 0 56.5 63.04" fill="none">
            <g transform="translate(18.38, -104.38)">
              <path
                d="m 22.7,142.59 c -20.84,1.77 -39.18,-13.69 -40.95,-34.54 -0.10,-1.22 -0.15,-2.45 -0.13,-3.67 l 16.99,0.21 c -0.14,11.53 9.09,21.00 20.63,21.14 0.68,0.01 1.35,-0.02 2.02,-0.07 z"
                fill="#92d050"
                fillOpacity="0.85"
              />
              <path
                d="m -1.88,167.42 c 0,-20.92 16.96,-37.88 37.88,-37.88 0.03,0 0.06,0 0.09,0 l -0.03,12.86 c -13.82,-0.03 -25.04,11.14 -25.07,24.96 0,0.02 0,0.04 0,0.06 z"
                fill="#002060"
                fillOpacity="0.85"
              />
              <path
                d="m -18.18,167.42 c 0,-20.92 16.96,-37.88 37.88,-37.88 1.66,0 3.32,0.11 4.97,0.33 l -2.15,16.27 c -11.75,-1.56 -22.54,6.71 -24.09,18.46 -0.12,0.93 -0.19,1.87 -0.19,2.82 z"
                fill="#ffc000"
                fillOpacity="0.85"
              />
              <path
                d="m 36.39,142.53 c -20.92,0 -37.88,-16.96 -37.88,-37.88 0,-0.03 0,-0.06 0,-0.09 l 12.86,0.03 c -0.03,13.82 11.14,25.04 24.96,25.07 0.02,0 0.04,0 0.06,0 z"
                fill="#ff0000"
                fillOpacity="0.85"
              />
            </g>
            {/* The vertical "I" bar (slightly thinner than the original to
                pair better with the bigger arcs at this scale). */}
            <rect x="40" y="0" width="14" height="62" fill="#0a0a0a" />
          </svg>
          <span
            style={{
              fontSize: "76px",
              fontWeight: 800,
              color: "#0a0a0a",
              letterSpacing: "-0.03em",
            }}
          >
            Iconic
          </span>
        </div>

        {/* Headline — same wording as the live hero, broken across lines so
            it fills the card without manual wrapping math. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
          }}
        >
          <span
            style={{
              fontSize: "72px",
              fontWeight: 800,
              color: "#0a0a0a",
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              maxWidth: "1000px",
            }}
          >
            From an address to a complete solar design in 30 seconds.
          </span>

          {/* Stack pill row — names the actual ML pipeline. */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginTop: "32px",
              flexWrap: "wrap",
            }}
          >
            {[
              "Cesium 3D Tiles",
              "GPT Image 2",
              "Hunyuan 3D Pro",
              "k-NN · 1,620 deliveries",
            ].map((label) => (
              <span
                key={label}
                style={{
                  display: "flex",
                  fontSize: "20px",
                  fontWeight: 600,
                  color: "#1e3a8a",
                  background: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  borderRadius: "9999px",
                  padding: "8px 18px",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
