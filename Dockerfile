# Multi-stage Dockerfile for Cloud Run.
#
# Stage 1 — `deps`     : install pnpm + node_modules from a clean lockfile.
# Stage 2 — `builder`  : run `next build`, then download Chromium so the
#                        runtime stage doesn't need network during cold start.
# Stage 3 — `runner`   : minimal slim image, ships only the standalone Next
#                        bundle + the Playwright browser cache + the system
#                        libs Chromium needs at runtime.
#
# Final image is ~500-600 MB (~300 MB Chromium + ~150 MB standalone Next +
# system libs). `next.config.ts` ships `output: 'standalone'` so we don't
# carry the full node_modules tree.

ARG NODE_VERSION=20-bookworm-slim

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── Stage 2: builder ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
# Pre-fetch Chromium into the project's local browser cache so the runtime
# image doesn't need internet on cold start. The browsers go into
# /app/.cache/ms-playwright by default.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
RUN npx playwright install chromium

# ─── Stage 3: runner ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# System libs Chromium needs at runtime. Pulled from Playwright's official
# `--with-deps` list, trimmed to the chromium-only set.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 fonts-liberation libdrm2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Standalone Next bundle (server.js + minimal node_modules + .next/server).
COPY --from=builder /app/.next/standalone ./
# Static assets and public/ aren't bundled into standalone — copy explicitly.
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# The Chromium binary downloaded at build time.
COPY --from=builder /app/.cache/ms-playwright /app/.cache/ms-playwright
# `playwright` package itself, needed to spawn the browser at runtime.
COPY --from=builder /app/node_modules/playwright /app/node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core /app/node_modules/playwright-core

EXPOSE 8080
CMD ["node", "server.js"]
