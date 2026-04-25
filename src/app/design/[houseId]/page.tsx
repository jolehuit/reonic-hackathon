// Cockpit page — assembled by all 4 devs.
// Layout: viewport 3D (left, full) + sidebar (right) + control panel (bottom) + modal overlay.

'use client';

import { use, useEffect } from 'react';
import { Scene3D } from '@/components/Scene3D/Scene3D';
import { Orchestrator } from '@/components/Scene3D/Orchestrator';
import { AgentTrace } from '@/components/AgentTrace/AgentTrace';
import { ProfileForm } from '@/components/AutoFillForm/ProfileForm';
import { ControlPanel } from '@/components/ControlPanel/ControlPanel';
import { KPISidebar } from '@/components/KPISidebar/KPISidebar';
import { EvidencePanel } from '@/components/EvidencePanel/EvidencePanel';
import { ApprovalModal } from '@/components/ApprovalModal/ApprovalModal';
import { useStore } from '@/lib/store';
import type { HouseId } from '@/lib/types';

interface Props {
  params: Promise<{ houseId: HouseId }>;
}

export default function DesignPage({ params }: Props) {
  const { houseId } = use(params);
  const selectHouse = useStore((s) => s.selectHouse);

  useEffect(() => {
    selectHouse(houseId);
  }, [houseId, selectHouse]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      {/* Background 3D viewport */}
      <div className="absolute inset-0">
        <Scene3D houseId={houseId} />
      </div>

      <Orchestrator />

      {/* Right sidebar */}
      <aside className="absolute right-4 top-4 flex w-80 flex-col gap-3">
        <AgentTrace />
        <KPISidebar />
        <EvidencePanel />
      </aside>

      {/* Bottom control panel */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-center">
        <ControlPanel />
      </div>

      {/* Auto-fill modal (centered, only during certain phases) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto">
          <ProfileForm />
        </div>
      </div>

      {/* HITL Review & Approve overlay */}
      <ApprovalModal />
    </main>
  );
}
