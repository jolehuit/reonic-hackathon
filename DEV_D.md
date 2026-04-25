# DEV D — 3D Tiles → Custom Engine → Stylized Model + Pioneer + Ship

**Branch** : `feat/geometry`
**Files owned** : `src/scripts/{fetch-3d-tiles,analyze-roof,generate-stylized,place-panels}.ts` + `public/baked/*` + `lib/pioneer.ts` (fine-tune side) + submission
**Pair sync** :
- Sat 17:00 with Dev A — checkpoint analyze-roof go/no-go
- Sat 11:00 floating with Dev B — confirm shape `analysis.json`
**Frozen** : aucun (zone autonome)
**Charge estimée** : ~12-14h utiles (très chargé, Pioneer en background)

---

## ⚠️ Le rôle, en 3 phrases

1. **Pipeline offline 3D Tiles → analyse → modèle stylé** : tu télécharges la photogrammétrie Google pour chaque adresse demo, tu fais tourner notre engine custom (DBSCAN ou estimation) dessus, tu génères un GLB low-poly architectural propre que Dev A affiche. **La mesh photogrammétrique brute n'est jamais visible côté user.**
2. **Pioneer fine-tune** (side challenge 700€) : tu pilotes le fine-tune classif sur 1 620 projets Reonic.
3. **Ship** : push GitHub + submission form Sun ≤ 14:00.

---

## Setup (10 min)

```bash
git checkout feat/geometry
pnpm install
cp .env.local.example .env.local
# Fill GOOGLE_MAPS_API_KEY — récupérer le compte temp Google DeepMind sur place
# Fill PIONEER_API_URL + PIONEER_API_KEY au stand Pioneer/Fastino
pnpm dev   # vérifier que /design/brandenburg affiche le procedural placeholder (cube blanc + toit rouge)
```

À lire avant de coder :
- https://github.com/NASA-AMMOS/3DTilesRendererJS (TilesRenderer + GoogleCloudAuthPlugin)
- https://developers.google.com/maps/documentation/tile/3d-tiles
- `node_modules/3d-tiles-renderer/README.md`

---

## Pipeline complet

```
1. fetch-3d-tiles.ts  → public/baked/{house}-photogrammetry.glb     (raw Google mesh, OFFLINE only)
2. analyze-roof.ts    → public/baked/{house}-analysis.json          (faces, obstructions, modulePositions, footprint, yield)
3. generate-stylized.ts → public/baked/{house}-stylized.glb         (low-poly clean mesh, used at runtime)
```

Dev A consomme `stylized.glb` (rendu) + `analysis.json` (panneaux + heatmap). Dev B consomme `analysis.json` (sizing).

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Critique ? |
|---|---|---|---|
| D0 | **Sat 15:00-17:00** : test fetch 3D Tiles offline (script Node ou page Vite headless) sur Brandenburg lat/lng. Output : un GLB téléchargé valide. | **2h hard timebox** | OUI |
| D1 | **🚨 Sat 17:00 CHECKPOINT pair A** : la mesh photogrammétrique chargée est-elle exploitable (DBSCAN convergent, building visible) ? Go/no-go. | 30min | OUI |
| D2a | **Si OK** : impl `analyze-roof.ts` complet (DBSCAN normales → faces + obstructions + yield + footprint + panneaux placés via `place-panels.ts`) | 2h30 | A, B |
| D2b | **Si KO** : fallback "estimate space" (autorisé par le brief) — ouvrir le GLB dans Blender, mesurer manuellement footprint + faces toit, hardcoder en JSON. 30min/maison × 3 = 1h30. | 1h30 | A, B |
| D3 | **`generate-stylized.ts`** : depuis analysis.json, construire un GLB low-poly (footprint + walls + toit incliné + chimney). White toon material, vertex flat shading | 2h | A wow |
| D4 | **`place-panels.ts::placePanelsOnFace`** : projection face polygon en 2D, edge offset 0.5m, grid 1.7×1.0m + 0.05 gap, filter dehors polygon AND obstructions, reproject en 3D | 1h | A panels |
| D5 | **Pioneer agent setup + lance fine-tune classif** Sat soir : synthetic data agent (~10k samples augmentés des 1620), fine-tune sur HP / module brand / inverter type | 1h + wait | side prize |
| D6 | **Pioneer monitor + deploy + REST endpoint** | 1h | partner tech |
| D7 | **`public/baked/house-profiles.json`** (sync `ProfileForm.tsx::HOUSE_PROFILES`) | 15min | UI |
| D8 | **Repo public** Sun 9-10h : `gh repo create` ou config remote (déjà fait sur jolehuit/reonic-hackathon) | 15min | submission |
| D9 | **Submission form + opt-in compétition** | 30min | submission |

---

## Mock-first stratégie (DÉJÀ EN PLACE)

`public/baked/brandenburg-analysis.json` est déjà committé en mock. Dev A a un placeholder procédural dans `House.tsx`. Donc A et B peuvent bosser **dès Sat 15:00 sans attendre toi**.

Tu remplaces les mocks au fur et à mesure :
1. Brandenburg `analysis.json` (override le mock) — avant 22h sam idéalement
2. `brandenburg-stylized.glb` (override le procedural placeholder)
3. Idem Hamburg + Ruhr

---

## Dépendances bloquantes

- **Bloque** : Dev A (le `stylized.glb` est ce qu'il rend), Dev B (`/api/design` lit `analysis.json`)
- **Bloqué par** : aucun (autonome)

---

## Fichiers à modifier

```
src/scripts/fetch-3d-tiles.ts        — squelette OK, à finir
src/scripts/analyze-roof.ts          — squelette OK, à finir
src/scripts/generate-stylized.ts     — squelette OK, à finir
src/scripts/place-panels.ts          — squelette OK, à finir
src/lib/pioneer.ts                   — REST endpoint Pioneer (Dev B câble la consommation côté API)
public/baked/brandenburg-analysis.json — override le mock
public/baked/hamburg-analysis.json   — créer
public/baked/ruhr-analysis.json      — créer
public/baked/{house}-photogrammetry.glb — output fetch-3d-tiles (NEVER serve in browser)
public/baked/{house}-stylized.glb    — output generate-stylized (Dev A consume this)
public/baked/house-profiles.json     — autofill profiles
```

---

## Critères d'acceptation

- [ ] `pnpm bake:fetch` produit 3 GLB photogrammétriques valides (jamais expose au front)
- [ ] `pnpm bake:analyze` produit 3 `analysis.json` avec faces, obstructions, modulePositions, footprint, yield
- [ ] `pnpm bake:stylize` produit 3 `stylized.glb` low-poly (loadables par `useGLTF`)
- [ ] Au runtime : Dev A charge `stylized.glb` au lieu du procedural placeholder
- [ ] `placePanelsOnFace(face, [], 24)` retourne 24 positions distinctes valides
- [ ] Pioneer endpoint répond pour les 3 classifs (HP / brand / inverter)
- [ ] Repo public sur GitHub (avant Sun 12h)
- [ ] Submission form rempli **avant Sun 14:00**

---

## Plan B (PRIORITÉ ABSOLUE)

Le brief autorise explicitement *"If that's too hard, build something that estimates the space available"*. C'est ton airbag.

| Cas | Plan B |
|---|---|
| **fetch-3d-tiles offline trop dur après 2h** | Skip, utiliser les Reonic GLBs d'origine (toujours dispos dans `public/models/`). On perd le pitch "any address" mais on garde la démo. |
| **DBSCAN converge mal sur la mesh photogrammétrique** | Fallback "estimate space" : Blender manuel → JSON. Brief OK. |
| **`generate-stylized.ts` trop dur** | Skip, garder le procedural placeholder dans `House.tsx` (cube + toit incliné code). C'est déjà joli. **Si tu fais ça, tu dois quand même ajuster les paramètres du placeholder par maison** (footprint + roof angle from analysis.json) pour que les 3 maisons aient l'air différentes. |
| **Pioneer fine-tune foire** | `PIONEER_DISABLED=true` env var → Dev B bascule k-NN. Tu perds le 700€ side challenge mais sauves la démo. |
| **`gh CLI` pas dispo / push lent** | `git remote add origin git@github.com:jolehuit/reonic-hackathon.git && git push -u origin main` (le remote est déjà configuré, il faut juste `git push`) |

---

## Hand-off

- Dev A consomme `public/baked/{house}-stylized.glb` + `{house}-analysis.json` (panneaux + heatmap)
- Dev B consomme `analysis.json` dans `/api/design`
- Tu pousses la submission finale et le repo public

Si tu finis tôt : aide Dev A sur le polish du modèle stylé ou Dev C sur les sons.
