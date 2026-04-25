# DEV C — UI / State / Flow / Polish / Loom

**Branch** : `feat/ui`
**Files owned** : `src/components/{AgentTrace,ControlPanel,KPISidebar,EvidencePanel,AutoFillForm,ApprovalModal}/*` + `src/lib/store.ts` + `src/app/page.tsx` + `public/sounds/*` (sourcing)
**Pair sync** :
- Sat 15:30 with Dev B — freeze types contracts (`lib/types.ts`)
- Sat 22:00 with Dev A — Orchestrator step machine ↔ animations
**Frozen** : `lib/types.ts` after Sat 15:30
**Charge estimée** : ~7h utiles + Loom recording lead Sun 10-12h

---

## Setup (5 min)

```bash
git checkout feat/ui
pnpm install
pnpm dev
# Click chip Brandenburg sur / → flow doit ouvrir /design/brandenburg
# Vérifier que phase=house-selected dans le store puis autofill puis ready-to-design
```

Test que `pnpm lint` passe (0 errors). Sinon : tu dois fix avant.

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Bloque ? |
|---|---|---|---|
| C1 | **Pair sync Sat 15:30 avec Dev B** : valider/freezer `lib/types.ts` | 30min | tout |
| C2 | **`app/page.tsx` landing polish** : hero plus joli, 3 chips bien stylées, footer "Built on 1620 deliveries" | 30min | démo |
| C3 | **`ProfileForm.tsx` polish** : typewriter déjà fonctionnel — vérifier visuellement (champs apparaissent un par un, bouton Generate apparaît à la fin) | 20min | démo |
| C4 | **`ControlPanel.tsx`** : sliders + 4 toggles déjà câblés. À polish : design + transitions framer-motion | 45min | démo |
| C5 | **`KPISidebar.tsx`** : springs déjà OK. Polish unit transitions, ajout d'une icône par KPI | 30min | démo |
| C6 | **`AgentTrace.tsx`** : déjà câblé avec status icons. Ajouter typewriter effect ligne par ligne (50ms par char) pour le label en `running` | 45min | wow |
| C7 | **Wire Gemini streaming** dans AgentTrace : appeler `/api/explain` durant phase=interactive, afficher le texte en bas de la trace | 45min | wow |
| C8 | **`EvidencePanel.tsx`** : déjà câblé avec deltas. Polish : 3 cards par projet similaire, animation slide-in | 45min | crédibilité |
| C9 | **`ApprovalModal.tsx`** : checklist + auto-check + PDF download déjà câblés. Polish animations | 45min | démo |
| C10 | **Sourcer les 6 mp3** dans `public/sounds/` (whoosh, scan, tick, paint, place, chime) — freesound.org / mixkit.co gratuits | 30min | wow |
| C11 | **Hook Howler dans Orchestrator** (pair avec Dev A) : trigger sound per step | 30min | wow |
| C12 | **Bug fixes UI + responsive desktop 1440x900** | 30min | démo |
| C13 | **Loom recording lead Sun 10-12h** : 5 prises, garder la meilleure | 2h | submission |

---

## Dépendances bloquantes

- **Bloque** : la démo entière (UI = ce que voit le jury)
- **Bloqué par** :
  - Dev B pour `DesignResult` (mais tu peux mocker en attendant : `setDesign(MOCK_DESIGN)` quand `phase=interactive`)
  - Dev A pour les animations (mais ton UI marche sans, juste moins wow)

---

## Fichiers à modifier

```
src/app/page.tsx
src/lib/store.ts                          — actions OK, polish si besoin
src/lib/types.ts                          — uniquement Sat 15:30 pair B+C
src/components/AgentTrace/AgentTrace.tsx
src/components/AutoFillForm/ProfileForm.tsx
src/components/ControlPanel/ControlPanel.tsx
src/components/KPISidebar/KPISidebar.tsx
src/components/EvidencePanel/EvidencePanel.tsx
src/components/ApprovalModal/ApprovalModal.tsx
public/sounds/*.mp3                       — À SOURCER (6 fichiers)
```

---

## Critères d'acceptation

- [ ] `pnpm lint` 0 errors (warnings OK sur stubs)
- [ ] Cliquer chip Brandenburg → autofill cinématique 3s → bouton Generate visible
- [ ] Cliquer Generate → sequence ~22s avec text streamé + sons subtle
- [ ] Sliders/toggles font update KPI live (avec ou sans backend Dev B)
- [ ] Review & Approve → PDF download (avec ou sans /api/export)
- [ ] Page responsive sur 1440x900 (laptop démo)
- [ ] Loom 2 min uploadé Sun avant 12h

---

## Plan B si bloqué

| Cas | Plan B |
|---|---|
| Sons impossibles à sourcer | Skip Howler entièrement, animation visuelle suffit |
| Backend Dev B en retard | Mock `DesignResult` hardcodé dans le store : `setDesign(MOCK_BRANDENBURG_DESIGN)` quand `agent-running` finit |
| Animations Dev A en retard | UI marche sans : tu vois juste la maison statique + sliders. Démo dégradée mais valide |
| PDF download foire (Dev B) | Fallback : ouvrir un nouvel onglet avec un screenshot canvas + données overlay HTML |
| Loom prises foirent | Backup : enregistrer en deux passes (audio narration + screen) puis mixer |

---

## Loom 2 min — script à préparer Sun 9h

**0-15s** : Hook
> "Designing a solar system at Reonic takes 25 minutes manually. We automate the 7 design steps with AI in seconds. Here's how."

**15-30s** : intro flow
> Click chip Brandenburg → autofill cinématique → "Generate"

**30-90s** : agent run + refinement
> Caméra dive, panneaux qui apparaissent, KPIs qui scroll, jury voit 1 toggle (EV) qui change le BOM live

**90-105s** : Reonic Evidence + crédibilité
> Click "Show similar projects" → "Notre design : 9.2 kWp · 47 projets Reonic similaires : 9.0±0.6 kWp ✓"

**105-115s** : Review & Export
> Modal HITL → checklist → Approve → PDF download

**115-120s** : close
> "Built on 1 620 real Reonic deliveries. 7 manual steps automated. github.com/[user]/reonic-hackathon"

---

## Hand-off

- Tu **assembles** ce que B et A produisent
- Tu **leads** la démo Loom
- Tu **fais** la démo live finale si on est qualifiés

Si tu finis tôt : aide A sur les sounds ou D sur le polish des roof JSON.
