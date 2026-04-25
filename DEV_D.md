# DEV D — Data Pipeline (3D Tiles → Analysis) + Pioneer + Ship

**Branch** : `feat/geometry`
**Files owned** : `src/scripts/{fetch-3d-tiles,analyze-roof,place-panels}.ts` + `public/baked/*-analysis.json` + `public/baked/{house}-photogrammetry.glb` (cache only) + Pioneer fine-tune ownership + submission
**Pair sync** :
- Sat 17:00 with Dev A — handoff `analysis.json` shape + format checkpoint
- Sat 11:00 floating with Dev B — confirm shape `analysis.json` consumed by `/api/design`
**Frozen** : aucun (zone autonome)
**Charge estimée** : ~10-12h utiles

---

## Le rôle, en 2 phrases

1. **Pipeline data offline** : tu télécharges la photogrammétrie 3D Tiles autour de chaque adresse demo, tu fais tourner notre engine custom (DBSCAN ou estimation simple) dessus, et tu produis un `{house}-analysis.json` que Dev A consomme pour générer le modèle stylé runtime.
2. **Ship** : push GitHub final + submission form Sun ≤ 14:00.

**Tu ne touches pas au rendu 3D.** Dev A possède tout le visuel.
**Pioneer fine-tune (side challenge 700€) a été transféré à Dev B** — décision pour soulager ta charge sur le 3D Tiles (zone risquée). Dev B owne maintenant tout le pipeline Pioneer (synthetic data + fine-tune + endpoint).

---

## Setup (10 min)

```bash
git checkout feat/geometry
pnpm install
cp .env.local.example .env.local
# Fill GOOGLE_MAPS_API_KEY (compte temp Google DeepMind sur place)
# Fill PIONEER_API_URL + PIONEER_API_KEY au stand Pioneer/Fastino
pnpm dev   # vérifier que /design/brandenburg affiche le procedural placeholder de Dev A
```

À lire :
- https://github.com/NASA-AMMOS/3DTilesRendererJS (TilesRenderer + GoogleCloudAuthPlugin)
- https://developers.google.com/maps/documentation/tile/3d-tiles
- `node_modules/3d-tiles-renderer/README.md`

---

## Pipeline (deux étapes seulement)

```
1. fetch-3d-tiles.ts  → public/baked/{house}-photogrammetry.glb     (cache offline, JAMAIS servi côté front)
2. analyze-roof.ts    → public/baked/{house}-analysis.json          (footprint + faces + obstructions + modulePositions)
                                                                       ↓
                                                                Dev A consomme dans House.tsx (procedural runtime)
                                                                Dev B consomme dans /api/design (sizing + similar)
```

**Pas de generate-stylized.** Dev A construit la mesh stylée directement en r3f depuis ton `analysis.json`.

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Critique ? |
|---|---|---|---|
| D0 | **Sat 15:00-17:00** : test fetch 3D Tiles offline (script Node ou page Vite headless) sur Brandenburg lat/lng. Output : un GLB téléchargé valide. | **2h hard timebox** | OUI |
| D1 | **🚨 Sat 17:00 CHECKPOINT pair A** : la mesh photogrammétrique chargée est-elle exploitable (DBSCAN convergent, building visible) ? Go/no-go. | 30min | OUI |
| D2a | **Si OK** : impl `analyze-roof.ts` complet (DBSCAN normales → faces + obstructions + yield + footprint + panneaux placés via `place-panels.ts`) | 2h30 | A, B |
| D2b | **Si KO** : fallback "estimate space" (autorisé par le brief) — ouvrir le GLB dans Blender, mesurer manuellement footprint + faces toit, hardcoder en JSON. 30min/maison × 3 = 1h30. | 1h30 | A, B |
| D3 | **`place-panels.ts::placePanelsOnFace`** : projection face polygon en 2D, edge offset 0.5m, grid 1.7×1.0m + 0.05 gap, filter dehors polygon AND obstructions, reproject en 3D | 1h | A panels |
| ~~D4~~ | ~~Pioneer agent setup + fine-tune~~ — **TRANSFÉRÉ À DEV B** (multi-task fine-tune NER + decisions sur 805 vrais profils Reonic, déjà en cours) | — | — |
| ~~D5~~ | ~~Pioneer monitor + deploy~~ — **TRANSFÉRÉ À DEV B** | — | — |
| D6 | **`public/baked/house-profiles.json`** (sync `ProfileForm.tsx::HOUSE_PROFILES`) | 15min | UI |
| D7 | **Repo public** Sun 9-10h : déjà sur `jolehuit/reonic-hackathon` — vérifier que tous les pushs sont à jour | 15min | submission |
| D8 | **Submission form + opt-in compétition** | 30min | submission |

---

## Mock-first (DÉJÀ EN PLACE)

`public/baked/brandenburg-analysis.json` est committé en mock complet. Dev A a un placeholder procédural dans `House.tsx` qui marche déjà. Tu remplaces les mocks au fur et à mesure :
1. Brandenburg `analysis.json` (override le mock) — avant 22h sam idéalement
2. Hamburg + Ruhr `analysis.json`

---

## Dépendances bloquantes

- **Bloque** : Dev A (procedural model lit `analysis.json`), Dev B (`/api/design` lit `analysis.json`)
- **Bloqué par** : aucun (autonome)

---

## Fichiers à modifier

```
src/scripts/fetch-3d-tiles.ts        — squelette OK, à finir (download offline)
src/scripts/analyze-roof.ts          — squelette OK, à finir (DBSCAN + faces + obstructions + footprint)
src/scripts/place-panels.ts          — squelette OK, à finir (grid placement)
src/lib/pioneer.ts                   — Dev B owne le wrapper, mais tu peux contribuer côté env-var et endpoint URL
public/baked/brandenburg-analysis.json — override le mock
public/baked/hamburg-analysis.json   — créer
public/baked/ruhr-analysis.json      — créer
public/baked/{house}-photogrammetry.glb — output fetch-3d-tiles (NEVER serve in browser)
public/baked/house-profiles.json     — autofill profiles
```

**Ce que tu NE touches PAS** : `src/components/*` (Dev A + Dev C), `src/app/api/*` (Dev B). Tu produis seulement les JSON dans `public/baked/`.

---

## Critères d'acceptation

- [ ] `pnpm bake:fetch` produit 3 GLB photogrammétriques valides en cache (jamais expose au front)
- [ ] `pnpm bake:analyze` produit 3 `analysis.json` avec faces, obstructions, modulePositions, buildingFootprint, yield
- [ ] `placePanelsOnFace(face, [], 24)` retourne 24 positions distinctes valides
- [ ] Repo public sur GitHub à jour (avant Sun 12h)
- [ ] Submission form rempli **avant Sun 14:00**

---

## Plan B (PRIORITÉ ABSOLUE)

Le brief autorise explicitement *"If that's too hard, build something that estimates the space available"*.

| Cas | Plan B |
|---|---|
| **fetch-3d-tiles offline trop dur après 2h** | Skip 3D Tiles, ouvrir directement les GLBs Reonic d'origine (toujours dispos dans `public/models/`) dans Blender et hardcoder les analyses. On perd le pitch "any address" mais on garde la démo. |
| **DBSCAN converge mal** | Fallback "estimate space" : Blender manuel → JSON. Brief OK. 30min/maison. |

---

## Hand-off

- Dev A consomme `public/baked/{house}-analysis.json` dans `House.tsx` (procedural model) + `Panels.tsx` (modulePositions) + `Heatmap.tsx` (yieldKwhPerSqm par face)
- Dev B consomme `analysis.json` dans `/api/design`
- Tu pousses la submission finale et le repo public

Si tu finis tôt : aide Dev A sur le polish des paramètres procédural ou Dev B sur Pioneer wrapper.
