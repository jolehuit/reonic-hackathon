# DEV A — 3D Engine, Stylized Model & Animation Orchestration

**Branch** : `feat/3d`
**Files owned** : tout `src/components/Scene3D/*` (House.tsx, Panels.tsx, Inverter, Battery, HeatPump, Wallbox, Heatmap, Sun, CameraRig, Orchestrator) + `public/sounds/*`
**Pair sync** :
- Sat 17:00 with Dev D — handoff `analysis.json` (D fournit, A consomme)
- Sat 22:00 with Dev C — Orchestrator ↔ store ↔ animations
**Frozen** : `lib/types.ts` after Sat 15:30 (B+C pair)
**Charge estimée** : ~10h utiles

---

## Le rôle, en 1 phrase

Tu **possèdes tout le visuel** : tu génères le modèle 3D stylé **runtime en r3f** depuis le `analysis.json` que Dev D te livre (footprint + faces toiture + obstructions), tu rends les composants énergétiques (panneaux, batterie, etc.), tu pilotes la caméra cinématique et l'orchestrator d'animation. **3D Tiles brut n'est jamais affiché.** Style cible : architectural mockup / Apple Keynote.

---

## ⚠️ Architecture clé : la mesh stylée est **générée par l'AI agent** depuis l'analyse de Dev D

Dev D livre **uniquement** `public/baked/{house}-analysis.json` (footprint + faces + obstructions + panneaux + buildingFootprint). À partir de ces inputs + le résultat 3D Tiles, **l'AI génère le modèle stylé final** que le user voit. Dans la narrative démo, ça correspond à la phase **RENDER** de l'agent trace.

Tu as **2 façons d'implémenter** ça (à toi de choisir samedi selon ton temps) :

### Option A — Procédural pur (simple, safe, déjà câblé)
La fonction procédurale dans `House.tsx` lit `analysis.json` et construit la mesh r3f à la volée :
- Volumes de murs depuis `buildingFootprint.size`
- Plans de toit depuis `faces[].vertices` (BufferGeometry triangulée)
- Cheminées/lucarnes depuis `obstructions[]`
- Tout en `MeshToonMaterial` blanc cassé + outline shader noir au composer level

→ Le squelette est déjà dans `House.tsx`. Pitch : *"L'AI agent génère le modèle depuis l'analyse géométrique (procedural code triggered by the agent)"*.

### Option B — Gemini Vision + procédural (stretch goal, vraiment "AI-driven")
Pendant la phase RENDER, on appelle Gemini Vision avec un screenshot de la mesh photogrammétrique + analysis.json. Gemini retourne des params (couleurs murs, type de toit, balcons, etc.) → la fonction procédurale les utilise.

→ +2h dev en pair avec Dev B (qui possède `lib/gemini.ts`). Pitch beaucoup plus fort : *"Gemini Vision interprète la photogrammétrie et génère le mockup stylé"*.

### Reco
Commence Option A samedi (déjà prêt). Si tu finis tes autres tâches dimanche matin avant 8h et qu'il te reste de l'énergie, upgrade vers Option B. **Pas obligatoire** : la phase RENDER reste impressionnante en procédural.

Avantage commun : pas de GLB à baker, pas de fichier binaire, le modèle s'adapte automatiquement à n'importe quel `analysis.json`.

---

## Setup (5 min)

```bash
git checkout feat/3d
pnpm install
pnpm dev
```

`/design/brandenburg` doit afficher le **placeholder procédural** (cube blanc + toit rouge incliné) qui est dans `House.tsx`. Tu peux dev tout ton code dessus dès maintenant ; quand Dev D livre `brandenburg-stylized.glb`, le composant le détecte automatiquement et bascule.

À lire :
- https://github.com/pmndrs/postprocessing (Bloom, ToneMapping, OutlineEffect)
- https://drei.docs.pmnd.rs/ (`<Outlines>`, `<Environment>`, `<MeshTransmissionMaterial>`)

---

## Tâches (chronologiques avec ETA)

| # | Tâche | ETA | Critique ? |
|---|---|---|---|
| A1 | **Style "architectural mockup"** : `MeshToonMaterial` blanc cassé sur la maison + outline shader noir (drei `<Outlines>` ou `OutlineEffect` postprocessing). Sol = plan blanc avec contact shadow. Background gradient ciel doux. | 2h | wow |
| A2 | **Photorealism subtle** : `<Environment preset="apartment">` (lumière douce diffuse, pas trop chaude car notre style est minimaliste, PAS sunset comme avant) + Bloom léger + `ACESFilmic` tonemapping | 45min | wow |
| A3 | **CameraRig.tsx** : finir GSAP timeline (aerial dive 80→30→25 vers le centre du `buildingFootprint`, lookAt centré sur le toit) | 1h | wow |
| A4 | **Sun.tsx** : SunCalc → directionalLight position animée 12s pendant `phase=agent-running` (la lumière bouge subtilement sur le modèle stylé) | 45min | wow |
| A5 | **Composants 3D** (Inverter/Battery/HeatPump/Wallbox/Panels) en cohérence stylée — toon shaders, pas PBR. Animations spécifiques par step Orchestrator | 2h | démo |
| A6 | **Heatmap.tsx** : injecter vertex colors depuis `{house}-analysis.json` (faces[].yieldKwhPerSqm) sur le toit du modèle stylé. Turbo gradient subtle (pas trop saturé pour respecter le style architectural) | 1h | wow |
| A7 | **Sounds Howler.js** : sourcer 6 mp3 (whoosh/scan/tick/paint/place/chime) gratuits sur freesound.org, brancher sur les steps Orchestrator | 45min | wow |
| A8 | **FPS bench** sur MacBook moyen Sun 01:00. Si <60fps : alléger outline shader ou bloom | 30min | démo |

---

## Style guide (important)

Le style doit rester cohérent. Évite les pièges :

| À faire | À éviter |
|---|---|
| 🟢 Volume blanc cassé (`#f5f1ea` ou `#fafafa`) | 🔴 Couleurs saturées photoréalistes |
| 🟢 Outline shader noir (épaisseur 2-3px) | 🔴 Textures bumpy / photogrammétrie |
| 🟢 Sol clair avec subtle contact shadow | 🔴 Background HDR sunset bumpy |
| 🟢 Panneaux bleu profond `#1a3a6e` métallique | 🔴 Panneaux PBR ultra-réalistes (clash) |
| 🟢 Animations easing cubic, GSAP | 🔴 Bounce trop cartoony |
| 🟢 Heatmap turbo subtle (alpha bas) | 🔴 Heatmap saturé qui mange le toit |

→ Style cible : **Norman Foster rendering / Apple Maps low-poly**.

---

## Dépendances bloquantes

- **Bloque** : Dev C (Orchestrator drives ses composants UI)
- **Bloqué par** :
  - Dev D pour `public/baked/{house}-stylized.glb` (placeholder procédural en place → tu peux bosser parallèle dès Sat 15:00)
  - Dev D pour `public/baked/{house}-analysis.json` (mock Brandenburg déjà committé pour les modulePositions + faces)

---

## Fichiers à modifier

```
src/components/Scene3D/Scene3D.tsx        — assemble (déjà câblé, ajouter outline composer)
src/components/Scene3D/House.tsx          — déjà câblé pour stylized.glb + procedural fallback
src/components/Scene3D/Sun.tsx            — SunCalc useFrame
src/components/Scene3D/CameraRig.tsx      — GSAP timeline (squelette OK)
src/components/Scene3D/Inverter.tsx       — pop-in animation, toon material
src/components/Scene3D/Battery.tsx        — slide-up animation, toon
src/components/Scene3D/HeatPump.tsx       — fade-in + scale, toon
src/components/Scene3D/Wallbox.tsx        — fade-in, toon
src/components/Scene3D/Panels.tsx         — drop + bounce per panel, panneaux toon-bleus
src/components/Scene3D/Heatmap.tsx        — vertex colors apply (lit analysis.json)
src/components/Scene3D/Orchestrator.tsx   — step callbacks → animations
public/sounds/*.mp3                       — sourcer 6 fichiers
```

---

## Critères d'acceptation

- [ ] La séquence agent (~22s) joue de bout en bout sans crash sur `/design/brandenburg`
- [ ] 60 fps stable sur MacBook moyen pendant la démo
- [ ] Style architectural mockup cohérent (volume blanc + outline + sol clair)
- [ ] Click sur un toggle (EV/HP/Battery/Wallbox) ajoute/retire le bon objet 3D en live
- [ ] Sons subtle synced avec chaque step
- [ ] Quand Dev D livre `brandenburg-stylized.glb`, ça remplace le placeholder procédural sans toucher au code

---

## Plan B si bloqué

| Cas | Plan B |
|---|---|
| Outline shader trop lourd | drei `<Outlines>` simple sur les meshes (moins joli mais marche partout) |
| Stylized.glb pas livré par D | Garder le procedural placeholder (déjà en place dans House.tsx). Démo continue, look légèrement moins customisé par maison. |
| InstancedMesh + animation trop lourd | Passer en `<group>` de panneaux normaux (acceptable jusqu'à ~30 panneaux) |
| Heatmap vertex colors plante | Skip carrément — le brief ne le rend pas obligatoire |
| Sons impossibles à sourcer en 45min | Skip Howler, animation visuelle suffit |

---

## Hand-off

- Dev C consomme tes animations via le store (`phase` + `agentSteps`)
- Dev D te fournit `public/baked/{house}-stylized.glb` + `analysis.json`

Si tu finis tôt : aide Dev C sur le polish UI ou Dev D sur le `generate-stylized.ts`.
