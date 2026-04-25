# DEV A — 3D Engine & Animation Orchestration

**Branch** : `feat/3d`
**Files owned** : `src/components/Scene3D/*` + `src/components/Scene3D/Orchestrator.tsx` + `public/env/` + `public/sounds/` integration
**Pair sync** :
- Sat 17:00 with Dev D — DBSCAN go/no-go checkpoint
- Sat 22:00 with Dev C — Orchestrator ↔ store ↔ animations
**Frozen** : `lib/types.ts` after Sat 15:30 (B+C pair)
**Charge estimée** : ~8h utiles (kickoff Sat 15:00)

---

## Setup (5 min)

```bash
git checkout feat/3d
pnpm install
pnpm dev   # boots Next 16, http://localhost:3000/design/brandenburg should show GLB house
```

Vérifie que la maison Brandenburg charge et que la caméra tourne autour. Si oui : ready.

Si tu touches à un import 3D, lis avant : `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` (changes Next 16).

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Bloque ? |
|---|---|---|---|
| A1 | **Photorealism preset** : `<Environment preset="sunset">` (déjà là) + `<EffectComposer>` + `<Bloom>` + `<ToneMapping mode={ACESFilmic}>` + soft shadows | 1h30 | démo |
| A2 | **CameraRig.tsx** : finir GSAP timeline (aerial dive 80→30→25, lookAt 0,2,0) — squelette déjà créé | 45min | démo |
| A3 | **Sun.tsx** : SunCalc → directionalLight position animée 12s pendant `phase=agent-running` | 1h | wow |
| A4 | **6 composants 3D stubés à finir** (Inverter, Battery, HeatPump, Wallbox, Panels, Heatmap) — squelettes déjà créés. Animations spécifiques par step de l'Orchestrator | 2h30 | démo |
| A5 | **Heatmap.tsx** : injecter vertex colors depuis `public/baked/{house}-yield.json` (D fournit) sur la mesh roof. Turbo gradient. Animation sweep depuis le coin SO | 1h30 | wow |
| A6 | **Sounds Howler.js** : sourcer 6 mp3 (whoosh/scan/tick/paint/place/chime) gratuits sur freesound.org, brancher sur les steps Orchestrator | 45min | wow |
| A7 | **FPS bench** sur MacBook moyen Sun 01:00. Si <60fps : retirer bloom ou downscale HDR | 30min | démo |

---

## Dépendances bloquantes

- **Bloque** : Dev C (Orchestrator drives ses composants UI)
- **Bloqué par** :
  - Dev D pour `public/baked/{house}-roof.json` (mock déjà committé pour Brandenburg → tu peux bosser parallèle dès Sat 15:00)
  - Dev D pour `public/baked/{house}-yield.json` (vraie data nécessaire pour Heatmap polish — fallback : couleur uniforme verte)

---

## Fichiers à modifier (paths exacts)

```
src/components/Scene3D/Scene3D.tsx        — assemble tous les enfants (déjà câblé)
src/components/Scene3D/Sun.tsx            — SunCalc useFrame
src/components/Scene3D/CameraRig.tsx      — GSAP timeline (squelette OK)
src/components/Scene3D/Inverter.tsx       — pop-in animation
src/components/Scene3D/Battery.tsx        — slide-up animation
src/components/Scene3D/HeatPump.tsx       — fade-in + scale
src/components/Scene3D/Wallbox.tsx        — fade-in
src/components/Scene3D/Panels.tsx         — drop + bounce per panel
src/components/Scene3D/Heatmap.tsx        — vertex colors apply
src/components/Scene3D/Orchestrator.tsx   — step callbacks → animations
public/sounds/*.mp3                       — sourcer 6 fichiers
```

---

## Critères d'acceptation

- [ ] La séquence agent (~22s) joue de bout en bout sans crash sur `/design/brandenburg`
- [ ] 60 fps stable sur MacBook moyen pendant la démo
- [ ] Pas de FOUC : `<Suspense fallback>` cache le canvas pendant le GLB load
- [ ] Bloom + tonemapping ACES visibles (golden hour sunset)
- [ ] Click sur un toggle (EV/HP/Battery/Wallbox) ajoute/retire le bon objet 3D en live
- [ ] Sons subtle synced avec chaque step (whoosh à `load`, ticks à `faces`, paint à `yield`, place×N à `panels`, chime à `ready`)

---

## Plan B si bloqué

| Cas | Plan B |
|---|---|
| SunCalc trop lent ou cassé | Hardcoder position fixe `[20, 30, 10]` avec rotation lente useFrame |
| Bloom cassé | `<EffectComposer disableNormalPass>` ou retirer post-processing entièrement (garder ACES tonemapping seul via `gl.toneMapping`) |
| InstancedMesh + animation trop lourd | Passer en `<group>` de panneaux normaux (acceptable jusqu'à ~30 panneaux) |
| Heatmap vertex colors plante | Skip carrément — le PRD ne le rend pas obligatoire (cosmétique) |
| Sons impossibles à sourcer en 45min | Skip Howler entièrement, animation visuelle suffit |

---

## Hand-off

- Dev C consomme tes animations via le store (`phase` + `agentSteps`)
- Dev D te fournit `public/baked/{house}-yield.json` et `roof.json`

Si tu finis tôt : aide Dev C sur le polish UI Reonic Evidence panel ou Dev D sur le bake-yield.
