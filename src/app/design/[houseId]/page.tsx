// AI Designer cockpit — assembled by Dev C, owned jointly with Dev A.
// This is THE page the jury sees: a 3D scene + an AI agent trace running the
// 22s sequence + KPI/Evidence panels + a ControlPanel for live refinement +
// a HITL approval modal at the end.
//
// `houseId` is one of the 3 demo houses OR `'custom'` for any address typed
// via the Google Places autocomplete on the landing page.

'use client';

import { use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import type { HouseId } from '@/lib/types';
import { Scene3D } from '@/components/Scene3D/Scene3D';
import { Orchestrator } from '@/components/Scene3D/Orchestrator';
import { ProfileForm } from '@/components/AutoFillForm/ProfileForm';
import { AgentTrace } from '@/components/AgentTrace/AgentTrace';
import { KPISidebar } from '@/components/KPISidebar/KPISidebar';
import { ControlPanel } from '@/components/ControlPanel/ControlPanel';
import { ApprovalModal } from '@/components/ApprovalModal/ApprovalModal';

interface Props {
  params: Promise<{ houseId: string }>;
}

const KNOWN_HOUSE_IDS: HouseId[] = ['brandenburg', 'hamburg', 'ruhr'];

function isHouseId(value: string): value is HouseId {
  return KNOWN_HOUSE_IDS.includes(value as HouseId);
}

export default function DesignPage({ params }: Props) {
  const { houseId: rawHouseId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const phase = useStore((s) => s.phase);
  const selectedHouse = useStore((s) => s.selectedHouse);
  const customAddress = useStore((s) => s.customAddress);
  const design = useStore((s) => s.design);
  const setPhase = useStore((s) => s.setPhase);

  const isCustom = rawHouseId === 'custom';
  const houseId: HouseId | 'custom' | null = isCustom
    ? 'custom'
    : isHouseId(rawHouseId)
      ? rawHouseId
      : null;

  // Hydrate the store from URL params on mount. Demo chips link directly here
  // without going through landing-page state, so we have to (re)select the
  // house ourselves.
  useEffect(() => {
    if (houseId === null) return;
    if (houseId === 'custom') {
      // Custom address: lat/lng come in the URL, the full CustomAddress object
      // may already be in the store (set by AddressSearch on the landing
      // page). If we landed here directly with just URL params, rebuild it.
      const lat = parseFloat(searchParams.get('lat') ?? '');
      const lng = parseFloat(searchParams.get('lng') ?? '');
      const address = searchParams.get('address') ?? '';
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const existing = useStore.getState().customAddress;
        if (!existing || existing.lat !== lat || existing.lng !== lng) {
          useStore.getState().setCustomAddress({
            formatted: address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            lat,
            lng,
            placeId: searchParams.get('placeId') ?? undefined,
          });
        }
      } else if (!useStore.getState().customAddress) {
        // No coords anywhere — bounce home so the user can pick an address.
        router.replace('/');
        return;
      }
      useStore.getState().selectHouse('custom');
    } else {
      useStore.getState().selectHouse(houseId);
    }
  }, [houseId, router, searchParams]);

  // Demo houses: skip the manual form. As soon as the house is selected we
  // jump to autofilling so ProfileForm shows its 3-step typewriter.
  // Custom: stay in 'house-selected' so ProfileForm offers Auto / Manual.
  useEffect(() => {
    if (selectedHouse && selectedHouse !== 'custom' && phase === 'house-selected') {
      setPhase('autofilling');
    }
  }, [selectedHouse, phase, setPhase]);

  // For custom addresses, kick off /api/design as soon as we have coords so
  // the synthetic geometry lands in the store before the user clicks
  // "Generate". This makes the agent run feel instantaneous.
  useEffect(() => {
    if (selectedHouse !== 'custom' || !customAddress) return;
    if (design) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/design', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            houseId: 'custom',
            lat: customAddress.lat,
            lng: customAddress.lng,
            address: customAddress.formatted,
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        // Hydrate roof geometry so Scene3D has something to render before
        // the Orchestrator overwrites design.
        if (data?.geometry) {
          useStore.getState().setCustomRoofGeometry(data.geometry);
        }
        if (data?.profile == null) {
          // /api/design didn't echo a profile, so set a placeholder one so
          // Orchestrator can fire (it gates on `profile != null`).
          if (!useStore.getState().profile) {
            const heuristic = await import('@/lib/customRoof').then((m) =>
              m.inferProfileFromLocation(customAddress.lat, customAddress.lng),
            );
            useStore.getState().setProfile(heuristic);
          }
        }
      } catch {
        // Swallow — UI will surface the error via VisionStatusBadge.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHouse, customAddress, design]);

  if (houseId === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700">
        Unknown house: {rawHouseId}.{' '}
        <button
          onClick={() => router.push('/')}
          className="ml-2 underline hover:text-zinc-900"
        >
          Pick a demo house
        </button>
      </main>
    );
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-white">
      {/* The 3D scene fills the viewport. */}
      <Scene3D houseId={houseId} />

      {/* Drives the visible 22s agent sequence. */}
      <Orchestrator />

      {/* Overlays — pointer-events isolated per child so the canvas stays
          interactive everywhere except where the chrome lives. */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top-left badge */}
        <header className="pointer-events-auto absolute left-5 top-5 flex items-center gap-2.5">
          <button
            onClick={() => router.push('/')}
            className="flex h-9 items-center gap-2 rounded-xl bg-white/95 px-3 text-[13px] font-semibold text-zinc-700 shadow-sm backdrop-blur transition hover:text-zinc-900"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back
          </button>
          <div className="rounded-xl bg-white/95 px-3 py-1.5 text-[12px] font-medium text-zinc-700 shadow-sm backdrop-blur">
            <span className="font-bold text-zinc-900">Reonic</span>
            <span className="ml-1.5 text-zinc-500">AI Designer</span>
          </div>
        </header>

        {/* Form overlay during autofill / manual entry */}
        {(phase === 'autofilling' || phase === 'ready-to-design') && (
          <div className="pointer-events-auto absolute inset-0">
            <ProfileForm />
          </div>
        )}

        {/* Agent trace — visible from the moment the chain starts and stays
            after completion so the user can review what happened. */}
        {(phase === 'agent-running' ||
          phase === 'interactive' ||
          phase === 'reviewing' ||
          phase === 'approved') && (
          <div className="pointer-events-auto absolute left-5 top-20 max-h-[calc(100vh-7rem)] w-[360px] overflow-hidden">
            <AgentTrace />
          </div>
        )}

        {/* KPISidebar — right rail once design lands. */}
        {(phase === 'interactive' || phase === 'reviewing' || phase === 'approved') && (
          <div className="pointer-events-auto absolute right-5 top-5 w-[340px]">
            <KPISidebar />
          </div>
        )}

        {/* ControlPanel — bottom-centre, the main interaction surface once
            the scene is rendered. Hosts the consumption slider, the four
            energy toggles and the Review & Approve CTA in one row. */}
        {phase === 'interactive' && (
          <div className="pointer-events-auto absolute inset-x-0 bottom-6 flex justify-center px-5">
            <ControlPanel />
          </div>
        )}
      </div>

      {/* HITL approval modal — gated on phase=reviewing inside the component. */}
      <ApprovalModal />
    </main>
  );
}
