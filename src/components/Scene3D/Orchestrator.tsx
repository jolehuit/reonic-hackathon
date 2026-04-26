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
import { HOUSE_COORDS } from './vision/houseLatLng';
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
    sublabel: 'k-NN over 1,620 Reonic deliveries',
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

    let cancelled = false;
    const coords = resolveCoords(
      selectedHouse,
      customAddress?.lat,
      customAddress?.lng,
    );

    // ── Step "size" — fire /api/design in parallel with the imagery chain ──
    const body: Record<string, unknown> = { profile, houseId: selectedHouse };
    if (selectedHouse === 'custom' && customAddress) {
      body.lat = customAddress.lat;
      body.lng = customAddress.lng;
      body.address = customAddress.formatted;
    }
    const designPromise = (async () => {
      updateStepStatus('size', 'running');
      try {
        const r = await fetch('/api/design', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const design = r.ok ? await r.json() : null;
        if (cancelled) return null;
        if (design?.geometry) setCustomRoofGeometry(design.geometry);
        if (design) {
          setDesign(design);
          const totalKwp = Number(design.totalKwp);
          const price = Number(design.totalPriceEur);
          const payback = Number(design.paybackYears);
          const summary =
            Number.isFinite(totalKwp) && Number.isFinite(price) && Number.isFinite(payback)
              ? `${totalKwp.toFixed(1)} kWp · €${price.toLocaleString()} · ${payback.toFixed(1)}y payback`
              : undefined;
          updateStepFields('size', { status: 'done', resultLine: summary });
        } else {
          updateStepFields('size', { status: 'error' });
        }
        return design;
      } catch {
        if (cancelled) return null;
        updateStepFields('size', { status: 'error' });
        return null;
      }
    })();

    // ── Steps capture → clean → model — sequential dependency chain ────────
    const imageryPromise = (async () => {
      if (!coords) return;

      // Demo-house cache short-circuit: if `pnpm bake:houses` has been run,
      // public/cache/houses/manifest.json holds pre-baked aerial / clean / GLB
      // URLs for each demo house. Skip the (slow + paid) live pipeline.
      if (selectedHouse && selectedHouse !== 'custom') {
        const cached = await loadCachedHouse(selectedHouse).catch(() => null);
        if (cached && !cancelled) {
          updateStepStatus('capture', 'running');
          await new Promise((r) => setTimeout(r, 300));
          if (cancelled) return;
          updateStepFields('capture', { status: 'done', artifactUrl: cached.aerialUrl });

          updateStepStatus('clean', 'running');
          await new Promise((r) => setTimeout(r, 300));
          if (cancelled) return;
          updateStepFields('clean', { status: 'done', artifactUrl: cached.cleanUrl });

          updateStepStatus('model', 'running');
          setTrellisStatus('generating');
          await new Promise((r) => setTimeout(r, 400));
          if (cancelled) return;
          setGlbUrl(cached.glbUrl);
          setTrellisStatus('ready');
          updateStepFields('model', { status: 'done', resultLine: 'GLB ready (cached)' });
          return;
        }
      }

      // Step 1: capture (browser fetch of /api/aerial doubles as the
      // thumbnail load — we listen to <img> onLoad to know when it's done).
      const aerialUrl = `/api/aerial?lat=${coords.lat}&lng=${coords.lng}&zoom=20&tilted=1`;
      updateStepStatus('capture', 'running');
      const captureOk = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return resolve(false);
          updateStepFields('capture', { status: 'done', artifactUrl: aerialUrl });
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

      // Step 2: clean (GPT Image 2). Server pulls /api/aerial again — the
      // response is cache-control: public, max-age=300 so the second hit is
      // typically warm.
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
        updateStepFields('clean', { status: 'done', artifactUrl: cleanedImageUrl });
      } catch {
        if (cancelled) return;
        updateStepFields('clean', { status: 'error' });
        return;
      }

      // Step 3: model (Trellis). Pass the cleaned fal-hosted URL straight
      // through — no re-upload.
      updateStepStatus('model', 'running');
      setTrellisStatus('generating');
      try {
        const r = await fetch('/api/trellis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imageUrl: cleanedImageUrl }),
        });
        const j = (await r.json()) as { ok: boolean; glbUrl?: string; error?: string };
        if (cancelled) return;
        if (!j.ok || !j.glbUrl) {
          updateStepFields('model', { status: 'error' });
          setTrellisStatus('error');
          return;
        }
        setGlbUrl(j.glbUrl);
        setTrellisStatus('ready');
        updateStepFields('model', { status: 'done', resultLine: 'GLB ready' });
      } catch {
        if (cancelled) return;
        updateStepFields('model', { status: 'error' });
        setTrellisStatus('error');
      }
    })();

    // Flip to interactive once both lanes have settled.
    Promise.all([designPromise, imageryPromise]).then(() => {
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
  ]);

  return null;
}
