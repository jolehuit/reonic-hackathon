# Reonic AI Renewable Designer — Big Berlin Hack

> AI Design Assistant validated against 1 620 real Reonic deliveries.
> From address to signed offer in 30 seconds.

## Quick start

```bash
pnpm install
cp .env.local.example .env.local   # fill in keys
pnpm dev
```

Open http://localhost:3000

## Repo structure

```
src/
├── app/
│   ├── page.tsx                       ← Landing (Dev C)
│   ├── design/[houseId]/page.tsx      ← Cockpit (assembled)
│   └── api/
│       ├── design/route.ts            ← BOM endpoint  (Dev B)
│       ├── explain/route.ts           ← Gemini stream (Dev B)
│       └── export/route.ts            ← PDF gen       (Dev B)
├── components/
│   ├── Scene3D/                       ← Dev A
│   ├── AgentTrace/                    ← Dev C
│   ├── ControlPanel/                  ← Dev C
│   ├── KPISidebar/                    ← Dev C
│   ├── EvidencePanel/                 ← Dev C
│   ├── AutoFillForm/                  ← Dev C
│   └── ApprovalModal/                 ← Dev C
├── lib/
│   ├── types.ts                       ← Shared (B+C frozen Sat 12h)
│   ├── store.ts                       ← Dev C
│   ├── sizing.ts                      ← Dev B
│   ├── pioneer.ts                     ← Dev B
│   ├── gemini.ts                      ← Dev B
│   └── supabase.ts                    ← Dev B
└── scripts/
    ├── bake-roofs.ts                  ← Dev D (run once)
    ├── bake-yield.ts                  ← Dev D (run once)
    └── place-panels.ts                ← Dev D (used at runtime)

public/
├── models/                            ← 4 GLB photogrammetric (already copied)
├── baked/                             ← JSON output from Dev D scripts
├── env/                               ← HDR env map (Dev A to add sunset_2k.hdr)
└── sounds/                            ← 6 mp3 (Dev C to add)

data/                                  ← 4 CSVs Reonic (already copied)
```

## Owner per branch

| Branch | Dev | Files |
|---|---|---|
| `feat/3d` | A | `components/Scene3D/*` |
| `feat/backend` | B | `app/api/*` + `lib/{sizing,pioneer,gemini,supabase}.ts` |
| `feat/ui` | C | `components/{AgentTrace,ControlPanel,KPISidebar,EvidencePanel,AutoFillForm,ApprovalModal}/*` + `lib/store.ts` + `app/page.tsx` |
| `feat/geometry` | D | `scripts/*` + `public/baked/*` + GLB optimization |

`lib/types.ts` is shared. Frozen after Sat 12h pair sync (B+C).

## Stand-ups

- Sat 10:30 — kickoff
- Sat 14:00 — DBSCAN risk validated by Dev D
- Sat 19:00 — first end-to-end flow
- Sat 23:00 — Pioneer status + sleep schedule
- Sun 09:00 — freeze features, polish + Loom

## Stop coding: **Sun 10:00**

## Submission deadline: **Sun 14:00**

## Demo flow (PRD §5)

1. Land on `/`
2. Click a house chip → `/design/[id]`
3. Auto-fill form (typewriter ~3s)
4. Click "Generate design" → 22s agent sequence
5. Refine via sliders/toggles
6. "Review & Approve" → HITL modal → PDF export
