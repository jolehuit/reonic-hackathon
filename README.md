# Reonic AI Renewable Designer — Big Berlin Hack

> AI Design Assistant validated against 1 620 real Reonic deliveries.
> Choose a house, watch the AI design a complete renewable system.

## What it does

Automates the 7 manual design steps Reonic installers do today (draw roof → place panels → pick inverter → size battery → recommend heat pump → build BOM → quote). User picks one of 3 demo houses (Brandenburg, Hamburg, Ruhr), watches an AI agent run a visible design sequence, refines via sliders/toggles, validates via a HITL modal, and exports a 1-page PDF quick-offer.

## Stack (verified April 2026)

- **Next.js 16.2** + React 19 (App Router)
- **react-three-fiber 9.6** + drei 10.7 + postprocessing 3 (WebGL2)
- **three 0.184**, suncalc, gsap, framer-motion 12, zustand 5
- **Vercel AI SDK 6** + `@ai-sdk/google` (Gemini 3 Flash preview)
- **Pioneer (Fastino)** REST endpoint — classifier fine-tuned on the dataset
- **Tavily** — live German EEG/EnBW tariffs
- **k-NN in-memory** on 1 620 Reonic projects
- **@gltf-transform** for offline GLB optimization (KTX2 + Draco)

## Partner techs (3 required by Big Berlin Hack)

1. **Google DeepMind** — Gemini 3 Flash for agent reasoning + customer explainer streaming
2. **Pioneer (Fastino)** — Fine-tuned classifier on 1 620 Reonic projects (HP / module brand / inverter type)
3. **Tavily** — Live German solar tariff data

## Quick start

```bash
pnpm install
cp .env.local.example .env.local   # fill in keys (see below)
pnpm dev                            # http://localhost:3000
```

Required env vars (see `.env.local.example`) :
- `GOOGLE_GENERATIVE_AI_API_KEY` (mandatory)
- `PIONEER_API_URL` + `PIONEER_API_KEY` (set `PIONEER_DISABLED=true` to fall back to k-NN)
- `TAVILY_API_KEY` (free tier 1000 credits at tavily.com)

## Branch ownership

| Branch | Dev | Files | See |
|---|---|---|---|
| `feat/3d` | A | `components/Scene3D/*` | [DEV_A.md](./DEV_A.md) |
| `feat/backend` | B | `app/api/*` + `lib/{sizing,pioneer,gemini,supabase,financials}.ts` | [DEV_B.md](./DEV_B.md) |
| `feat/ui` | C | `components/{AgentTrace,ControlPanel,KPISidebar,EvidencePanel,AutoFillForm,ApprovalModal}/*` + `lib/store.ts` + `app/page.tsx` | [DEV_C.md](./DEV_C.md) |
| `feat/geometry` | D | `scripts/*` + `public/baked/*` + GLB optim + submission | [DEV_D.md](./DEV_D.md) |

`lib/types.ts` is shared. **Frozen after Sat 15:30** (B+C pair sync).

## Repo structure

```
src/
├── app/
│   ├── page.tsx                       ← Landing (Dev C)
│   ├── design/[houseId]/page.tsx      ← Cockpit (assembled)
│   └── api/
│       ├── design/route.ts            ← BOM endpoint   (Dev B)
│       ├── explain/route.ts           ← Gemini stream  (Dev B)
│       ├── export/route.ts            ← PDF gen        (Dev B)
│       └── health/route.ts            ← uptime probe
├── components/
│   ├── Scene3D/                       ← Dev A (House, Sun, Panels, Inverter, Battery, HeatPump, Wallbox, Heatmap, CameraRig, Orchestrator)
│   ├── AgentTrace/                    ← Dev C
│   ├── ControlPanel/                  ← Dev C
│   ├── KPISidebar/                    ← Dev C
│   ├── EvidencePanel/                 ← Dev C
│   ├── AutoFillForm/                  ← Dev C
│   └── ApprovalModal/                 ← Dev C
├── lib/
│   ├── types.ts                       ← Shared (B+C frozen Sat 15:30)
│   ├── store.ts                       ← Dev C
│   ├── sizing.ts · pioneer.ts · gemini.ts · supabase.ts ← Dev B
└── scripts/
    ├── bake-roofs.ts · bake-yield.ts · place-panels.ts ← Dev D

public/
├── models/                            ← 3 GLB photogrammetric (Brandenburg, Hamburg, Ruhr)
├── baked/                             ← JSON output from Dev D scripts (mock Brandenburg already committed)
├── env/                               ← HDR env map (drei sunset preset for now)
└── sounds/                            ← 6 mp3 (Dev C to source)

data/                                  ← 4 CSVs Reonic (1 620 projects + 21 651 BOM lines)
```

## Note on Next.js 16 breaking changes

Before touching `app/api/*` or middleware, read `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`. Notably : `middleware.ts` is renamed `proxy.ts`, `revalidateTag()` requires a `cacheLife` profile.

## Timeline (kickoff Sat 15:00 → submission Sun 14:00)

- **Sat 15:00** — kickoff stand-up
- **Sat 15:30** — B+C pair : freeze `lib/types.ts`
- **Sat 17:00** — A+D pair : DBSCAN go/no-go checkpoint
- **Sat 22:00** — A+C pair : Orchestrator ↔ animations
- **Sun 02:00-08:00** — sleep
- **Sun 10:00** — 🛑 STOP CODING
- **Sun 10:00-12:00** — Loom recording (Dev C lead)
- **Sun ≤ 14:00** — submission form

## Demo flow

1. Land on `/`
2. Click a house chip → `/design/[id]`
3. Auto-fill form (typewriter ~3s)
4. Click "Generate design" → ~22s agent sequence
5. Refine via sliders/toggles (KPIs update live)
6. Click "Show similar projects" (Reonic Evidence)
7. "Review & Approve" → HITL modal → PDF download
