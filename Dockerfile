# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for Cloud Run, optimised for fast Cloud Build runs.
#
# Stage 1 — `deps`     : install pnpm + node_modules from a frozen lockfile.
#                        Uses a BuildKit cache mount on the pnpm store so
#                        repeat builds finish in ~5-10s instead of ~30-60s.
# Stage 2 — `builder`  : run `next build`. Based on the official Microsoft
#                        Playwright image so Chromium + every X11/font lib
#                        are PRE-INSTALLED — saves ~90s vs `npx playwright
#                        install` and ~30s vs apt-get'ing the libs ourselves.
# Stage 3 — `runner`   : minimal slim image, ships only the standalone Next
#                        bundle + the Playwright browser cache + the system
#                        libs Chromium needs at runtime.
#
# Final image is ~500-600 MB. `next.config.ts` ships `output: 'standalone'`
# so we don't carry the full node_modules tree.

ARG NODE_VERSION=20-bookworm-slim
ARG PLAYWRIGHT_VERSION=v1.59.1

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
# .npmrc carries `public-hoist-pattern[]=playwright-core` — required so the
# runner stage's `COPY .../node_modules/playwright-core` resolves. Without it
# pnpm's strict layout keeps playwright-core under .pnpm/ only.
COPY package.json pnpm-lock.yaml .npmrc ./
# BuildKit cache mount on the pnpm content-addressable store. Across builds
# only the deps that actually changed get re-downloaded.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Stage 2: builder ───────────────────────────────────────────────────────
# Microsoft Playwright image already has Chromium + every required system
# library + Node.js. We just need pnpm. Saves ~120s vs node:slim + apt-get +
# `npx playwright install chromium`.
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-jammy AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

# NEXT_PUBLIC_* vars must be present at `next build` time (Next inlines them
# into the client bundle). Cloud Build passes this via --build-arg.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Playwright keeps the bundled chromium under /ms-playwright in this image.
# We DO want it under /app/.cache/ms-playwright in the runner so the runtime
# stage can COPY it cleanly. Move the prebuilt browsers into the project
# cache with a hardlink — instant, no second download.
RUN mkdir -p /app/.cache/ms-playwright \
 && cp -al /ms-playwright/. /app/.cache/ms-playwright/

# ─── Stage 3: runner ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# System libs Chromium needs at runtime. We can't reuse the Playwright base
# here because it's ~1.5 GB — the slim runner is much faster to cold-start
# on Cloud Run.
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
# k-NN sizing in /api/design reads CSVs from /app/data at runtime via
# fs.readFileSync (not a JS import), so Next's standalone tracer doesn't
# pick them up. Copy the dataset explicitly. ~2.5 MB.
COPY --from=builder /app/data ./data
# The Chromium binary moved into the project cache during the builder stage.
COPY --from=builder /app/.cache/ms-playwright /app/.cache/ms-playwright
# `playwright` package itself, needed to spawn the browser at runtime.
COPY --from=builder /app/node_modules/playwright /app/node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core /app/node_modules/playwright-core

EXPOSE 8080
CMD ["node", "server.js"]
