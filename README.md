# Iconic — AI Renewable Designer

### 🌐 Live demo: **[iconic.haus](https://iconic.haus)**

> **Reonic Track · Big Berlin Hack 2026**
> From an address to a complete solar design in ~30 seconds — PV, battery, heat pump and wallbox sized against 1,620 real Reonic deliveries, validated on the actual roof geometry of the customer's house.
>
> ⚡️ **Built without the Google Solar API.** Roof geometry, orientation, tilt, obstructions and yield are derived end-to-end from Google Photorealistic 3D Tiles + our own DBSCAN/photogrammetry pipeline — no Solar API call, no `buildingInsights`, no `solarPotential` shortcut.

Iconic automates the design steps a Reonic installer does by hand today: drawing the roof, placing modules, picking an inverter, sizing the battery, recommending a heat pump, computing the BOM and producing a quick-offer PDF. The user (installer or end customer) types an address — or picks one of three pre-validated demo houses — and watches an AI agent run the full design pipeline live. Everything is then refinable via sliders / toggles before exporting a 1-page PDF offer.

---

## How it answers the Reonic brief

The track brief asked for four things; here is how each one is wired in:

| Reonic ask | Implementation |
|---|---|
| Estimate modules from the demand profile | k-NN on 1,620 projects (`src/lib/sizing.ts`) — median totalKwp of the 10 nearest deliveries. Plafonné by the roof's physical capacity. |
| Use photogrammetry / Google 3D Tiles to detect roof and place modules | `bake:fetch` pulls Google Photorealistic 3D Tiles around (lat, lng); `bake:analyze` runs DBSCAN on triangle normals to extract roof faces, then `place-panels.ts` lays a panel grid per face with obstruction avoidance. |
| Build an offer from the placed modules | `/api/design` joins the geometric `modulesMax` with the k-NN BOM signals, computes financials in `lib/financials.ts`, returns a complete `DesignResult`. |
| Combine PV + battery + heat pump appropriately | k-NN co-recommends battery and heat pump only when ≥ 5 of the top-10 neighbours had one — so a 2-person flat with a gas boiler doesn't get sold a heat pump it doesn't need. |

The "play with Google 3D Tiles" suggestion is taken literally: every custom address goes through a real Cesium + Google 3D Tiles capture, not a synthetic roof. The fallback synthetic-roof path was deliberately removed.

> **No Google Solar API.** We never call `solar.googleapis.com` (`buildingInsights`, `dataLayers`, `solarPotential`, `roofSegmentStats`, …). Every roof-derived number — usable area, tilt, azimuth, panel count, annual yield — is computed in-house from the photogrammetric mesh. This is a deliberate design choice so the pipeline works on any building anywhere in the world, including regions the Solar API doesn't cover.

---

## Live pipeline (custom address)

When a user types an address that is **not** one of the demo houses, the Orchestrator runs four steps end-to-end:

```
1. CAPTURE  /api/aerial?tilted=1   Cesium + Google Photorealistic 3D Tiles
                                   → oblique PNG of the building
2. CLEAN    /api/clean-image       fal · openai/gpt-image-2/edit
                                   → strips trees / cars / neighbours
                                   → cleaned PNG on white background
3. SIZE     /api/design            k-NN on 1,620 Reonic deliveries
                                   → totalKwp / battery / HP / financials
                                   (runs in parallel from t = 0)
4. MODEL    /api/trellis           fal · fal-ai/hunyuan-3d/v3.1/pro/image-to-3d
                                   → textured GLB of the building
```

Capture / Clean / Model are sequential (each consumes the previous output). Sizing runs in parallel from the start — it only depends on the customer profile + roof capacity. Each step writes its output to `public/cache/houses/live-{lat}-{lng}/` so the next visit to the same address is instant.

Demo houses skip Capture / Clean / Model — their photogrammetry was already analysed offline and committed under `public/baked/{houseId}-analysis.json`.

---

## Demo houses

Three pre-validated buildings drive the no-input demo flow:

| ID | Address | Profile |
|---|---|---|
| `berlin-dahlem` | Thielallee 36, Berlin | 140 m² · 3 inhabitants · gas · EV |
| `potsdam-golm` | Potsdam-Golm | 165 m² · 4 inhabitants · oil |
| `berlin-karow` | Schönerlinder Weg 83, Berlin Karow | 190 m² · 5 inhabitants · oil |

Each one ships with a baked `*-photogrammetry.json` + `*-analysis.json` under `public/baked/` (output of the offline DBSCAN roof analysis), plus the legacy raw GLB under `public/models/` used as the fetch target.

---

## Stack

- **Next.js 16.2.4** (App Router, React 19) — note: this version has breaking changes vs. earlier majors; check `node_modules/next/dist/docs/` before touching `app/api/*` or middleware
- **react-three-fiber 9.6** + **drei 10.7** + **postprocessing 3** on **three 0.184**
- **3d-tiles-renderer 0.4** with `GoogleCloudAuthPlugin` for the offline tile fetch
- **density-clustering** (DBSCAN) + **concaveman** for roof-plane extraction
- **suncalc** for shade / yield estimation
- **gsap** + **framer-motion 12** for the agent-trace animations
- **zustand 5** as the single source of truth for the front-end state machine (`src/lib/store.ts`)
- **AI SDK 6** + **@ai-sdk/google** — Gemini 3.1 Flash Lite generates the personalised PDF note
- **fal queue API** — direct REST (we don't use `@fal-ai/client`) for GPT Image 2 + Hunyuan 3D
- **Tavily** REST — local solar incentive lookups, embedded in the PDF
- **jsPDF** — A4 1-page quick-offer
- **Playwright** — runs the headless Cesium scene that produces the oblique screenshot

---

## Quick start

```bash
pnpm install
cp .env.local.example .env.local   # fill in the keys you have
pnpm dev                            # http://localhost:3000
```

### Environment variables

All keys are optional **except** `GOOGLE_MAPS_API_KEY` if you want the custom-address flow to work. Each integration degrades gracefully when its key is missing.

| Variable | Used by | Behaviour without it |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | `/api/aerial` (Static Maps + 3D Tiles) | Custom-address capture fails. Demo houses still work. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Landing-page address autocomplete | Free-text input only, no Place suggestions. |
| `FAL_KEY` | `/api/clean-image`, `/api/trellis` | Custom-address Clean + Model steps fail; demo houses unaffected. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `/api/export` (PDF narrative) | PDF ships without page 2 (the personalised note). |
| `TAVILY_API_KEY` | `/api/export` (incentive lookups) | PDF ships without the "Local incentives" block. |
| `GEMINI_MODEL` | `/api/export` | Defaults to `gemini-3.1-flash-lite-preview`. |
| `DISABLE_LIVE_FETCH` | `/api/design` | Set to `1` to disable the live bake fallback (CI / read-only). |

Reonic refunds Google 3D Tiles costs per the track brief — see `.env.local.example` for setup notes.

---

## Demo flow

1. **Land** on `/` — pick a demo house chip *or* type any address (Google Places autocomplete).
2. **Auto-fill** — the customer profile fills via a 3-step typewriter (~3 s for demo houses; custom addresses get a heuristic seed instantly so the form never stalls).
3. **Generate design** — click the button; the Orchestrator runs the 4-step chain, the AgentTrace narrates each step, and the 3D scene assembles incrementally as artifacts arrive.
4. **Refine** — sliders for annual consumption, toggles for battery / heat pump / wallbox; KPIs update live via `useEffectiveDesign`.
5. **Reonic Evidence** — "Show similar projects" surfaces the top-5 Reonic deliveries the k-NN matched against, with delta-vs-median.
6. **Review & Approve** — HITL modal recaps the BOM; on confirm, `/api/export` returns a 1-page PDF.

---

## Repo structure

```
src/
├── app/
│   ├── page.tsx                       Landing (hero + Try-a-demo modal + AddressSearch)
│   ├── design/[houseId]/page.tsx      Cockpit (Scene3D + AgentTrace + Form + KPIs + Controls)
│   ├── oblique/                       Headless Cesium page rendered by Playwright for tilted aerial
│   └── api/
│       ├── aerial/route.ts            Google Static Maps (top-down) or Cesium 3D Tiles (tilted)
│       ├── clean-image/route.ts       fal · gpt-image-2/edit
│       ├── trellis/route.ts           fal · hunyuan-3d/v3.1/pro/image-to-3d
│       ├── design/route.ts            k-NN sizing + financials, with live bake fallback
│       ├── export/route.ts            jsPDF + Gemini + Tavily → PDF download
│       └── health/route.ts            uptime probe
├── components/
│   ├── Scene3D/                       House, Sun, Panels, Inverter, Battery, HeatPump,
│   │                                  Wallbox, ElectricCar, Heatmap, CameraRig, Orchestrator,
│   │                                  TrellisModel (Hunyuan output viewer), GltfAsset, …
│   ├── AgentTrace/                    Live step-by-step narration of the 4-step chain
│   ├── ControlPanel/                  Bottom bar: consumption slider + 4 toggles + Approve CTA
│   ├── KPISidebar/                    Right rail: kWp, kWh, payback, CO₂, self-consumption
│   ├── AutoFillForm/                  AddressSearch (Places autocomplete), CustomAddressForm,
│   │                                  ProfileForm (typewriter for demo houses)
│   └── ApprovalModal/                 HITL review + PDF export
└── lib/
    ├── types.ts                       Shared contracts (HouseId, CustomerProfile, RoofGeometry,
    │                                  DesignResult, AgentStep, AppPhase, …)
    ├── store.ts                       Zustand state machine
    ├── sizing.ts                      k-NN engine (1,620 Reonic projects, in-memory)
    ├── financials.ts                  EEG/Verivox 2026 constants → price, payback, CO₂
    ├── customRoof.ts                  defaultCustomerProfile() — seeds the autofill form
    ├── houses.ts                      Demo-house metadata (profile, coords, address)
    ├── coords.ts                      ECEF / lat-lng helpers
    ├── fal.ts                         Thin REST wrapper over fal queue
    ├── tavily.ts                      Solar-incentive search
    ├── report.ts                      Gemini-generated PDF narrative
    ├── ms-building-footprints.ts      Microsoft Building Footprints lookup (analyze-roof.ts)
    ├── lod2-buildings.ts              German LoD2 fallback
    ├── trellis.ts                     Hunyuan/Trellis client helpers
    ├── cacheKey.ts                    liveCacheKey(lat, lng) — 6-decimal slug ≈ 10 cm
    └── useEffectiveDesign.ts          Re-derives KPIs live from refinement toggles

scripts/                                Playwright + Node utilities (capture-tiles, generate-house,
                                       inspect-scale, check-panels, …)

src/scripts/                            Offline bake pipeline:
├── fetch-3d-tiles.ts                  Pulls Google 3D Tiles → public/baked/{id}-photogrammetry.*
├── analyze-roof.ts                    DBSCAN on triangle normals → roof faces + obstructions
├── analyze-multi.ts                   Runs analyze-roof with several knob variants, picks best
├── place-panels.ts                    Lays out modules on each face with shade sampling
├── bake-houses.ts                     Demo-house orchestration
└── backtest.ts                        Validates k-NN against held-out projects

public/
├── baked/                             *-analysis.json + *-photogrammetry.json (committed)
├── cache/                             Runtime cache: aerial PNGs + per-address artifacts
├── models/                            GLB assets: house meshes, heat pump, Powerwall, Tesla,
│                                       wallbox, etc.
├── sounds/                            Sound effects for the agent trace
└── tiles/                             Static tiles served to the headless Cesium page

data/
├── projects_status_quo_{1,2}.csv      1,620 Reonic projects (customer inputs)
├── project_options_parts_{1,2}.csv    21,651 BOM line items
├── backtest-results.csv               k-NN validation output
└── backtest-summary.json              Backtest metrics
```

---

## Offline bake pipeline

Used to seed the three demo houses and to enrich the Reonic dataset with extra benchmarks (`b3-*`, `bench-*`):

```bash
pnpm bake:fetch              # Google 3D Tiles → public/baked/{house}-photogrammetry.*
pnpm bake:analyze            # DBSCAN → public/baked/{house}-analysis.json
pnpm bake:analyze:multi      # Multi-variant analyse, picks the best layout
pnpm bake:all                # bake:fetch + bake:analyze
```

The raw photogrammetric mesh is **never rendered** to the user — it is consumed only by `analyze-roof.ts` to extract roof faces, obstructions, and panel positions. The displayed mesh for custom addresses is the Hunyuan 3D Pro reconstruction; for demo houses it is a hand-modelled clean GLB under `public/models/`.

---

## Scripts

```bash
pnpm dev                     # next dev (http://localhost:3000)
pnpm build                   # next build
pnpm start                   # next start (prod)
pnpm lint                    # ESLint (next config)
pnpm test                    # Vitest run
pnpm test:watch              # Vitest watch
```

---

## License

See [LICENSING.md](./LICENSING.md). Reonic CSV data under `data/` is provided by Reonic for the Big Berlin Hack and is not redistributable.
