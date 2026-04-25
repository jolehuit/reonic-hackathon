# DEV B — AI / Data / Backend

**Branch** : `feat/backend`
**Files owned** : `src/lib/{sizing,pioneer,gemini,supabase}.ts` + `src/app/api/*` + `lib/financials.ts` (à créer)
**Pair sync** :
- Sat 15:30 with Dev C — freeze types contracts (`lib/types.ts`)
- Sat 22:00 floating — Dev C plug `/api/design` results into store
**Frozen** : `lib/types.ts` after Sat 15:30
**Charge estimée** : ~7h utiles

---

## Setup (10 min)

```bash
git checkout feat/backend
pnpm install
cp .env.local.example .env.local
# Fill GOOGLE_GENERATIVE_AI_API_KEY (récupérer compte temp Google DeepMind sur place)
# Fill TAVILY_API_KEY (signup tavily.com → 1000 free credits, code TVLY-DLEE5IJU si épuisés)
# PIONEER_API_URL et PIONEER_API_KEY : à récupérer du stand Pioneer/Fastino
pnpm dev
curl -X POST http://localhost:3000/api/design -H 'content-type: application/json' -d '{}'  # 501 attendu
```

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Bloque ? |
|---|---|---|---|
| B1 | **Pair sync Sat 15:30 avec Dev C** : valider/freezer `lib/types.ts` (CustomerProfile, DesignResult, SimilarProject, RoofGeometry) | 30min | tout |
| B2 | **`lib/sizing.ts::recommendSystem` + `findSimilarProjects`** : load 4 CSVs en mémoire au boot, k-NN k=5 sur features normalisées (z-score), aggregate median pour kWp/kWh/price, return top-3 similar | 1h30 | démo |
| B3 | **`lib/financials.ts`** (nouveau fichier) : payback, ROI 25y, CO2 saved (0.4 kg/kWh × 25y) | 30min | UI KPI |
| B4 | **`/api/design/route.ts`** : load roof JSON `public/baked/{houseId}-roof.json` (mock Brandenburg déjà fourni), compute roofMaxKwp = sum(face.area × yieldKwhPerSqm × 0.18 / 1000), call `predictBomViaPioneer`, build `modulePositions` via `placePanelsOnFace` (D fournit), return DesignResult complet | 1h30 | démo |
| B5 | **`lib/pioneer.ts`** : POST REST endpoint Pioneer pour classif (HP/brand/inverter), parse JSON. **Fallback k-NN heuristique** si `PIONEER_DISABLED=true` ou erreur. Latency log pour le pitch. | 1h | wow |
| B6 | **Pioneer fine-tune launch** Sat ~17h après stack ready : agent setup + génération synthetic data (~10k samples augmentés des 1620 réels) + lance fine-tune classification (HP / module brand / inverter type) | 1h (+ wait time) | side prize |
| B7 | **`/api/explain/route.ts`** : déjà câblé avec Gemini streaming. Tester avec une vraie clé Gemini et vérifier que `streamText` rend bien | 20min | wow |
| B8 | **`/api/export/route.ts`** : jsPDF, header adresse, screenshot canvasDataUrl reçu du front, table BOM, total + ROI + CO2, footer "Approved by [date]" | 1h30 | démo |
| B9 | **Tavily integration** : 1 fetch `tavily.search('current EnBW solar feed-in tariff 2026 Germany')` au boot du serveur, cache mémoire, expose dans `/api/design` response. 5 lignes de code | 20min | partner tech valid |
| B10 | **Backtest 200 holdout** Sun 8h : split 80/20 dataset, run sizing.ts sur 200 hold, calc accuracy (kWp ±10%, batt ±2kWh) → screenshot bar chart pour pitch | 30min | crédibilité |
| B11 | **Vercel deploy** + env vars prod | 30min | live demo |

---

## Dépendances bloquantes

- **Bloque** : Dev C (besoin de `DesignResult` pour KPI/Evidence/Approval), Dev A (`modulePositions` pour Panels)
- **Bloqué par** :
  - Dev D pour `public/baked/{house}-roof.json` (mock Brandenburg déjà committé → tu peux bosser parallèle)
  - Dev D pour `placePanelsOnFace` (`src/scripts/place-panels.ts`) — appelé depuis `/api/design`. Mock simple en attendant : grid 6×4 = 24 panels sur la face SSW.

---

## Fichiers à modifier

```
src/lib/sizing.ts        — k-NN impl
src/lib/pioneer.ts       — REST endpoint + fallback
src/lib/gemini.ts        — déjà câblé, vérifier streamText
src/lib/supabase.ts      — optionnel (in-memory CSVs suffit pour 1620 lignes)
src/lib/financials.ts    — À CRÉER
src/app/api/design/route.ts
src/app/api/explain/route.ts
src/app/api/export/route.ts
src/lib/types.ts         — uniquement pair sync 15:30 avec Dev C
data/projects_status_quo_*.csv  — déjà copiés (à parser)
data/project_options_parts_*.csv
```

---

## Critères d'acceptation

- [ ] `POST /api/design` avec un profil Brandenburg renvoie un DesignResult cohérent en <500ms
- [ ] Fallback `PIONEER_DISABLED=true` route tout sur k-NN sans crash
- [ ] `/api/explain` stream du texte Gemini en real-time (visible côté front)
- [ ] `/api/export` renvoie un PDF binaire downloadable d'1 page
- [ ] Backtest 200 holdout : kWp dans ±10% sur ≥80% des projets test (stat à montrer dans le Loom)
- [ ] Tavily fetch retourne un tarif EEG/EnBW chiffré (cache visible dans logs)

---

## Plan B si bloqué

| Cas | Plan B |
|---|---|
| Pioneer fine-tune foire ou pas de clé API | `PIONEER_DISABLED=true` → k-NN heuristique pour tout. On garde le mention Pioneer dans le pitch (REST endpoint mocké, fine-tune lancé mais output non-utilisé) |
| jsPDF chiant pour la screenshot | Fallback : générer un HTML page imprimable et utiliser `window.print()` côté client |
| Supabase trop lourd à setup | CSVs en mémoire au boot du Next server (1 619 lignes = 13 KB, trivial). Skip Supabase entièrement. |
| Tavily rate limit ou down | Hardcoder tariff = 0.082 €/kWh feed-in, 0.39 €/kWh consumer (valeurs DE 2026 connues). Garder le `tavily.search` call mais avec try/catch silencieux |
| Backtest pas le temps | Hardcoder "84% match" dans le pitch comme estimation conservative — on est en hackathon |

---

## Hand-off

- Dev C call `/api/design` depuis `Orchestrator.tsx` (déjà câblé, vérifier shape de retour)
- Dev A consomme `design.modulePositions` dans `Panels.tsx` via le store
- Dev D : tu lui demandes le shape `RoofGeometry` exact si pas clair

Si tu finis tôt : implémente le 4e use case "regenerate" (bouton qui re-run /api/design avec les sliders changés et anime les diff).
