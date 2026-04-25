# DEV D — Geometry Auto-detection (DBSCAN + yield + panels)

**Branch** : `feat/geometry`
**Files owned** : `src/scripts/{bake-roofs,bake-yield,place-panels}.ts` + `public/baked/*` + `public/models/*` (optimization) + `public/baked/house-profiles.json` + submission form
**Pair sync** :
- Sat 17:00 with Dev A — DBSCAN go/no-go checkpoint **CRITIQUE**
- Sat 11:00 floating with Dev B — confirmer le shape attendu pour `RoofGeometry`
**Frozen** : aucun (zone autonome)
**Charge estimée** : ~7-10h utiles selon DBSCAN ou plan B Blender

---

## ⚠️ Tu portes le risque #1 du projet

Le brief Reonic dit *"detect the roof spaces and obstructions, place modules automatically. **If that's too hard, build something that estimates the space available**"*. Tu as donc l'autorisation explicite du brief de fallback.

**Mock Brandenburg déjà committé** dans `public/baked/brandenburg-roof.json` — A et B peuvent bosser parallèle dès Sat 15:00. Tu n'es **pas le bottleneck** du démarrage.

---

## Setup (5 min)

```bash
git checkout feat/geometry
pnpm install   # @gltf-transform/core déjà installé
pnpm bake:roofs  # devrait juste log et écrire des JSON vides actuellement
```

Tester `Three.BufferGeometry` parsing sur un GLB : si tu n'as jamais fait, **valide ton skill au kickoff Sat 15h** avant de t'engager.

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Bloque ? |
|---|---|---|---|
| D0 | **Sat 15:00-17:00** : test DBSCAN sur Brandenburg.glb (load via `@gltf-transform/core`, extract triangles, compute normals, run DBSCAN, visualize clusters in console) | **2h hard timebox** | tout |
| D1 | **🚨 Sat 17:00 CHECKPOINT pair A** : visualiser dans le browser les clusters détectés, juger qualité — go/no-go | 30min | tout |
| D2a | **Si DBSCAN OK** : impl complète `bake-roofs.ts` (4 maisons → 4 JSON `RoofGeometry`) | 2h | A, B |
| D2b | **Si DBSCAN KO** : ouvrir les 3 GLB dans Blender, sélectionner visuellement les faces toit, exporter coords en JSON manuellement | 1h30 | A, B |
| D3 | **`bake-yield.ts`** : sun positions × raycasting × angle of incidence → vertex colors RGB turbo gradient. Sample 12h/jour × 12 jours/an au lieu de 8760h pour speed (acceptable pour démo) | 2h | A heatmap |
| D4 | **`place-panels.ts::placePanelsOnFace`** : project face polygon to 2D, edge offset 0.5m, grid generation (1.7×1.0m + 0.05 gap), filter cells inside polygon AND outside obstructions, project back to 3D | 1h30 | A panels |
| D5 | **GLB optimization** : `pnpm dlx @gltf-transform/cli optimize public/models/brandenburg.glb public/models/brandenburg.glb` (KTX2 + Draco) cible <8MB | 30min | démo perf |
| D6 | **`public/baked/house-profiles.json`** (sync avec `ProfileForm.tsx::HOUSE_PROFILES`) | 15min | UI |
| D7 | **Push GitHub public** Sun 9h : `gh repo create reonic-hackathon --public --source=. --push` | 15min | submission |
| D8 | **Submission form** Sun 12-14h : opt-in compétition + upload Loom URL + repo URL | 30min | submission |

---

## Dépendances bloquantes

- **Bloque** : Dev A (yield JSON pour Heatmap, panel positions), Dev B (`/api/design` lit `roof.json` au runtime)
- **Bloqué par** : aucun (zone autonome)

**Stratégie mock-first** : `public/baked/brandenburg-roof.json` est déjà committé en mock pour débloquer A et B dès Sat 15:00. Tu produiras les vraies données pour Hamburg + Ruhr (et override Brandenburg) au fur et à mesure.

---

## Fichiers à modifier

```
src/scripts/bake-roofs.ts
src/scripts/bake-yield.ts
src/scripts/place-panels.ts
public/baked/brandenburg-roof.json    — override mock
public/baked/hamburg-roof.json        — créer
public/baked/ruhr-roof.json           — créer
public/baked/{house}-yield.json       — créer (3 fichiers)
public/baked/house-profiles.json      — créer (sync ProfileForm)
public/models/*.glb                   — optimize via @gltf-transform/cli
package.json                          — déjà à jour avec scripts bake:*
```

---

## Critères d'acceptation

- [ ] `pnpm bake:roofs` produit 3 JSON valides matching le shape `RoofGeometry`
- [ ] `pnpm bake:yield` produit 3 JSON avec arrays de couleurs RGB
- [ ] `placePanelsOnFace(face, [], 24)` retourne 24 positions distinctes valides
- [ ] Brandenburg.glb optimisé <8MB (vs 27MB original)
- [ ] Repo public sur GitHub (avant Sun 12h)
- [ ] Submission form rempli avant **Sun 14:00**

---

## Plan B si bloqué (PRIORITÉ ABSOLUE)

| Cas | Plan B |
|---|---|
| **DBSCAN ne donne pas de clusters propres après 2h** | Ouvrir GLB dans Blender, identifier visuellement 3-4 plans de toiture, **hardcoder** un JSON par maison. C'est explicite dans le brief : *"if too hard, estimate space available"*. **2h max sur D0, sinon switch fallback à 17:00 strict** |
| **Yield raycasting trop coûteux** | Sample 12h/jour × 12 jours/an au lieu de 8760h. Ou ne calculer le yield que par face (constante par face), pas par triangle |
| **placePanels merdique** | Grid simple sans rotation, panneaux alignés avec north-axis (acceptable cosmétiquement) |
| **GLB optimization plante** | Garder les GLB raw — load lent mais ça marche |
| **gh CLI pas installé sur le poste** | Push manuellement via `git remote add origin https://github.com/<user>/reonic-hackathon && git push -u origin main` après création repo dans le browser |

---

## Hand-off

- Dev B consomme `public/baked/{house}-roof.json` dans `/api/design`
- Dev A consomme `public/baked/{house}-yield.json` dans `Heatmap.tsx`
- Tu portes la submission finale : repo GitHub public + form opt-in compétition

Si tu finis tôt : aide Dev A sur le polish 3D ou Dev C sur la sélection de sons.
