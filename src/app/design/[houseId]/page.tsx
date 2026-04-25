// Cockpit page — assembled by all 4 devs.
//
// Layout phases:
//   - During `agent-running` : the AgentTrace takes a prominent left side panel
//     (full visibility on the AI thinking + computing + rendering phases).
//   - From `interactive` onwards : AgentTrace collapses, the user sees the clean
//     stylized model + KPIs + sliders + evidence panel.

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
  const phase = useStore((s) => s.phase);
  const selectHouse = useStore((s) => s.selectHouse);

  useEffect(() => {
    selectHouse(houseId);
  }, [houseId, selectHouse]);

  const showFullTrace = phase === 'agent-running' || phase === 'interactive';

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      {/* Background 3D viewport */}
      <div className="absolute inset-0">
        <Scene3D houseId={houseId} />
      </div>

      <Orchestrator />

      {/* AI agent trace — prominent during agent-running, hidden after */}
      {showFullTrace && (
        <aside className="absolute left-4 top-4 z-20 w-[380px]">
          <AgentTrace />
        </aside>
      )}

      {/* Right sidebar — KPIs + Evidence are visible from interactive onwards */}
      {phase !== 'agent-running' && phase !== 'autofilling' && phase !== 'house-selected' && phase !== 'idle' && phase !== 'ready-to-design' && (
        <aside className="absolute right-4 top-4 flex w-80 flex-col gap-3">
          <KPISidebar />
          <EvidencePanel />
        </aside>
      )}

      {/* Bottom control panel — only shown when interactive */}
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
