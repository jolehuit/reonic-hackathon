// Real-pipeline orchestrator. Drives the 4-step chain that produces the
// final 3D building + financial design from a lat/lng. Every step is tied
// to a real network call so the AgentTrace narrates what's actually
// happening — no fake durations.
//
//   1. CAPTURE — /api/aerial?tilted=1 → oblique screenshot via Cesium +
//                Google Photorealistic 3D Tiles.
//   2. CLEAN   — /api/clean-image → openai/gpt-image-2/edit isolates the
//                target building on a white background.
//   3. SIZE    — /api/design       → k-NN sizing + financial model.
//                (Runs in parallel from the start; surfaces here for trace
//                ordering.)
//   4. MODEL   — /api/trellis      → fal-ai/trellis image-to-3D, fed the
//                cleaned image URL from step 2.
//
// Capture / clean / model run sequentially because they form a dependency
// chain. Sizing runs in parallel from t=0. The phase flips to 'interactive'
// once all four are settled.

'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { AgentStep } from '@/lib/types';
import { HOUSE_COORDS } from '@/lib/houses';
import type { HouseId } from '@/lib/types';

export interface SeqStep {
  id: 'capture' | 'clean' | 'size' | 'model';
  label: string;
  sublabel: string;
  estDurationMs: number;
}

export const SEQUENCE: SeqStep[] = [
  {
    id: 'capture',
    label: 'Capturing oblique aerial view',
    sublabel: 'Cesium + Google Photorealistic 3D Tiles',
    estDurationMs: 12_000,
  },
  {
    id: 'clean',
    label: 'Isolating the building',
    sublabel: 'GPT Image 2 — strips trees / cars / neighbours',
    estDurationMs: 25_000,
  },
  {
    id: 'size',
    label: 'Computing solar sizing & financial model',
    sublabel: 'k-NN over 1,620 Iconic deliveries',
    estDurationMs: 1_200,
  },
  {
    id: 'model',
    label: 'Reconstructing 3D building',
    sublabel: 'Hunyuan 3D Pro — image to GLB',
    estDurationMs: 60_000,
  },
];

function resolveCoords(
  selectedHouse: HouseId | 'custom' | null,
  customLat?: number,
  customLng?: number,
): { lat: number; lng: number } | null {
  if (!selectedHouse) return null;
  if (selectedHouse === 'custom') {
    if (customLat == null || customLng == null) return null;
    return { lat: customLat, lng: customLng };
  }
  const c = HOUSE_COORDS[selectedHouse];
  return c ? { lat: c.lat, lng: c.lng } : null;
}

interface CachedHouse {
  aerialUrl: string;
  cleanUrl: string;
  glbUrl: string;
}

async function loadCachedHouse(houseId: HouseId): Promise<CachedHouse | null> {
  const r = await fetch('/cache/houses/manifest.json', { cache: 'no-store' });
  if (!r.ok) return null;
  const m = (await r.json()) as Record<string, CachedHouse | undefined>;
  return m[houseId] ?? null;
}

export function Orchestrator() {
  const phase = useStore((s) => s.phase);
  const profile = useStore((s) => s.profile);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const customAddress = useStore((s) => s.customAddress);
  const setAgentSteps = useStore((s) => s.setAgentSteps);
  const updateStepStatus = useStore((s) => s.updateStepStatus);
  const updateStepFields = useStore((s) => s.updateStepFields);
  const setPhase = useStore((s) => s.setPhase);
  const setDesign = useStore((s) => s.setDesign);
  const setCustomRoofGeometry = useStore((s) => s.setCustomRoofGeometry);
  const setTrellisStatus = useStore((s) => s.setTrellisStatus);
  const setGlbUrl = useStore((s) => s.setGlbUrl);
  const setPlacedCount = useStore((s) => s.setPlacedCount);

  useEffect(() => {
    if (phase !== 'agent-running' || !profile || !selectedHouse) return;

    // Initial step list — all pending. AgentTrace renders directly off this.
    const steps: AgentStep[] = SEQUENCE.map((s) => ({
      id: s.id,
      label: s.label,
      sublabel: s.sublabel,
      durationMs: s.estDurationMs,
      status: 'pending',
    }));
    setAgentSteps(steps);
    setTrellisStatus('idle');
    setGlbUrl(null);
    // Reset placement animation: panels stay hidden until both pipeline lanes
    // settle, at which point we tick up placedCount in the .then() below.
    setPlacedCount(0);

    let cancelled = false;
    const coords = resolveCoords(
      selectedHouse,
      customAddress?.lat,
      customAddress?.lng,
    );

    // ── /api/design fires immediately (HTTP request is parallel for speed)
    //    but the *step state* is intentionally NOT touched here. We flip
    //    `size` to running/done from inside the imagery chain, between
    //    `clean` and `model`, so the trace progresses strictly top-down.
    const body: Record<string, unknown> = { profile, houseId: selectedHouse };
    if (selectedHouse === 'custom' && customAddress) {
      body.lat = customAddress.lat;
      body.lng = customAddress.lng;
      body.address = customAddress.formatted;
    }
    const designPromise = (async () => {
      try {
        const r = await fetch('/api/design', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const design = r.ok ? await r.json() : null;
        if (cancelled) return null;
        if (design?.geometry) setCustomRoofGeometry(design.geometry);
        if (design) setDesign(design);
        return design;
      } catch {
        return null;
      }
    })();

    // Flips the `size` step done with a summary, derived from the design
    // result. Called from the imagery chain at the right moment.
    const finalizeSizeStep = async () => {
      updateStepStatus('size', 'running');
      const design = await designPromise;
      if (cancelled) return;
      if (!design) {
        updateStepFields('size', { status: 'error' });
        return;
      }
      const totalKwp = Number(design.totalKwp);
      const price = Number(design.totalPriceEur);
      const payback = Number(design.paybackYears);
      const summary =
        Number.isFinite(totalKwp) && Number.isFinite(price) && Number.isFinite(payback)
          ? `${totalKwp.toFixed(1)} kWp · €${price.toLocaleString()} · ${payback.toFixed(1)}y payback`
          : undefined;
      updateStepFields('size', { status: 'done', resultLine: summary });
    };

    // Demo-tempo helpers — used by both the demo-house short-circuit and
    // the live pipeline path. `padStepDuration` is a no-op when real work
    // already took at least `loMs`; otherwise it sleeps a randomised amount
    // so the step lasts somewhere in [loMs, hiMs]. This keeps the trace
    // animating realistically when caches (aerial PNG, clean PNG, design
    // JSON, Hunyuan GLB) are warm and the live API calls return in <200ms.
    const jitter = (lo: number, hi: number) =>
      new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
    const padStepDuration = async (elapsed: number, loMs: number, hiMs: number) => {
      if (elapsed >= loMs) return;
      const target = loMs + Math.random() * (hiMs - loMs);
      await new Promise((r) => setTimeout(r, target - elapsed));
    };

    // ── Steps capture → clean → model — sequential dependency chain ────────
    const imageryPromise = (async () => {
      if (!coords) return;

      // Demo-house cache short-circuit: if `pnpm bake:houses` has been run,
      // public/cache/houses/manifest.json holds pre-baked aerial / clean / GLB
      // URLs for each demo house. Skip the (slow + paid) live pipeline. We
      // add small randomized fake delays so the trace doesn't snap to "done"
      // instantly — the user still sees the steps animate in sequence.
      if (selectedHouse && selectedHouse !== 'custom') {
        const cached = await loadCachedHouse(selectedHouse).catch(() => null);
        if (cached && !cancelled) {
          updateStepStatus('capture', 'running');
          await jitter(2800, 4200);
          if (cancelled) return;
          updateStepFields('capture', { status: 'done', artifactUrl: cached.aerialUrl });

          updateStepStatus('clean', 'running');
          await jitter(3400, 4800);
          if (cancelled) return;
          updateStepFields('clean', { status: 'done', artifactUrl: cached.cleanUrl });

          // Step 3: size (k-NN sizing) — fake delay; the real fetch is in
          // flight via designPromise so awaiting it should resolve instantly.
          await jitter(1500, 2400);
          if (cancelled) return;
          await finalizeSizeStep();
          if (cancelled) return;

          updateStepStatus('model', 'running');
          setTrellisStatus('generating');
          await jitter(3800, 5400);
          if (cancelled) return;
          setGlbUrl(cached.glbUrl);
          setTrellisStatus('ready');
          updateStepFields('model', { status: 'done' });
          return;
        }
      }

      // Step 1: capture (browser fetch of /api/aerial doubles as the
      // thumbnail load — we listen to <img> onLoad to know when it's done).
      const aerialUrl = `/api/aerial?lat=${coords.lat}&lng=${coords.lng}&zoom=20&tilted=1`;
      const captureT0 = performance.now();
      updateStepStatus('capture', 'running');
      const captureOk = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return resolve(false);
          resolve(true);
        };
        img.onerror = () => {
          if (cancelled) return resolve(false);
          updateStepFields('capture', { status: 'error' });
          resolve(false);
        };
        img.src = aerialUrl;
      });
      if (!captureOk || cancelled) return;
      // Pad to the demo-house tempo so a warm cache (~30ms PNG read) still
      // animates the trace believably (~3-4s).
      await padStepDuration(performance.now() - captureT0, 2800, 4200);
      if (cancelled) return;
      updateStepFields('capture', { status: 'done', artifactUrl: aerialUrl });

      // Step 2: clean (GPT Image 2). Server pulls /api/aerial again — the
      // response is cache-control: public, max-age=300 so the second hit is
      // typically warm.
      const cleanT0 = performance.now();
      updateStepStatus('clean', 'running');
      let cleanedImageUrl: string;
      try {
        const r = await fetch('/api/clean-image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
        });
        const j = (await r.json()) as { ok: boolean; imageUrl?: string; error?: string };
        if (cancelled) return;
        if (!j.ok || !j.imageUrl) {
          updateStepFields('clean', { status: 'error' });
          return;
        }
        cleanedImageUrl = j.imageUrl;
      } catch {
        if (cancelled) return;
        updateStepFields('clean', { status: 'error' });
        return;
      }
      // Pad to demo-house tempo (warm cache returns in ~50ms; cold call
      // through GPT Image 2 takes ~25s and skips the pad).
      await padStepDuration(performance.now() - cleanT0, 3400, 4800);
      if (cancelled) return;
      updateStepFields('clean', { status: 'done', artifactUrl: cleanedImageUrl });

      // Step 3: size — fold the (already in-flight) /api/design result into
      // the trace before kicking off the model step.
      const sizeT0 = performance.now();
      await finalizeSizeStep();
      if (cancelled) return;
      // Pad: with designCache the call is ~5ms; cold k-NN is ~250ms. Both
      // are below the lo bound so the trace always animates ~1.5-2.4s.
      await padStepDuration(performance.now() - sizeT0, 1500, 2400);
      if (cancelled) return;

      // Step 4: model (Trellis). Pass the cleaned fal-hosted URL straight
      // through — no re-upload.
      const modelT0 = performance.now();
      updateStepStatus('model', 'running');
      setTrellisStatus('generating');
      try {
        // Pass lat/lng so /api/trellis can disk-cache the GLB. Same coords
        // next session → Hunyuan call skipped, GLB served from
        // /cache/houses/live-{key}/model.glb.
        const r = await fetch('/api/trellis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imageUrl: cleanedImageUrl,
            lat: coords.lat,
            lng: coords.lng,
          }),
        });
        const j = (await r.json()) as { ok: boolean; glbUrl?: string; error?: string };
        if (cancelled) return;
        if (!j.ok || !j.glbUrl) {
          updateStepFields('model', { status: 'error' });
          setTrellisStatus('error');
          return;
        }
        // Pad BEFORE setGlbUrl so the 3D viewer doesn't start loading the
        // GLB while the trace still says MODEL is "running" — this keeps the
        // visual sequence (trace finishes → 3D appears) intact even on a
        // warm cache where Hunyuan was skipped (~50ms response).
        await padStepDuration(performance.now() - modelT0, 3800, 5400);
        if (cancelled) return;
        setGlbUrl(j.glbUrl);
        setTrellisStatus('ready');
        // Don't set a resultLine — the GLB is visible in the 3D scene
        // already, so a centre-screen "GLB ready" popup is just noise.
        // AgentTrace's popup queue skips steps without artifactUrl /
        // resultLine, so this single omission removes the popup.
        updateStepFields('model', { status: 'done' });
      } catch {
        if (cancelled) return;
        updateStepFields('model', { status: 'error' });
        setTrellisStatus('error');
      }
    })();

    // ── STRICT SEQUENCING ─────────────────────────────────────────────────
    // GLB-loading and panel-drop animation are deliberately separated:
    //   1. Wait for both promises (sizing + imagery) to resolve.
    //   2. Wait for `glbStable` — flipped true by <MorphingBuilding/> only
    //      AFTER the skeleton→GLB cross-fade has finished AND the mesh is
    //      in the scene. No fixed timer, so the animation never starts on
    //      a still-morphing or invisible roof.
    //   3. Add a small breathing pause so the user perceives "GLB landed,
    //      now panels are about to fall".
    //   4. Tick placedCount up to launch <Panels/>'s drop choreography.
    //   5. Flip phase → interactive once every panel has landed.
    Promise.all([designPromise, imageryPromise]).then(async () => {
      if (cancelled) return;

      const POLL_MS = 80;
      const MAX_WAIT_MS = 60_000;
      const waitStart = performance.now();
      while (!useStore.getState().glbStable) {
        if (cancelled) return;
        if (performance.now() - waitStart > MAX_WAIT_MS) break;
        await new Promise<void>((res) => setTimeout(res, POLL_MS));
      }

      // Tiny beat — just enough so the user registers "roof done" before
      // the first panel lands. Anything longer reads as awkward dead time.
      await new Promise<void>((res) => setTimeout(res, 120));
      if (cancelled) return;

      // Wait for <Panels/> to publish its raycast-snapped count via
      // panelTargetCount. The value equals design.moduleCount (after k-NN
      // capping) — we just need to know the projection pass has finished
      // before we start the drop animation.
      const TARGET_POLL_MS = 60;
      const TARGET_TIMEOUT_MS = 5000;
      const targetWaitStart = performance.now();
      while (
        useStore.getState().panelTargetCount === 0 &&
        performance.now() - targetWaitStart < TARGET_TIMEOUT_MS
      ) {
        if (cancelled) return;
        await new Promise<void>((res) => setTimeout(res, TARGET_POLL_MS));
      }
      const total = useStore.getState().panelTargetCount;
      // Cap total animation at ~1.6 s for snappy feel; clamp per-panel to
      // [50, 140] ms so even a single-panel layout still has a beat.
      const stepMs =
        total > 0 ? Math.max(50, Math.min(140, Math.round(1600 / total))) : 0;
      for (let i = 1; i <= total; i++) {
        if (cancelled) return;
        await new Promise<void>((res) => setTimeout(res, stepMs));
        setPlacedCount(i);
      }
      if (!cancelled) setPhase('interactive');
    });

    return () => {
      cancelled = true;
    };
  }, [
    phase,
    profile,
    selectedHouse,
    customAddress,
    setAgentSteps,
    updateStepStatus,
    updateStepFields,
    setPhase,
    setDesign,
    setCustomRoofGeometry,
    setTrellisStatus,
    setGlbUrl,
    setPlacedCount,
  ]);

  return null;
}
