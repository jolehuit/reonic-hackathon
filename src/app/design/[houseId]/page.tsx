// Plan Solar designer page.
// Hosts all chrome state (controlled components) and renders the viewer slot.
// The Cesium viewer is owned by another agent; ViewerSlot stays as a
// placeholder until /tmp/build-viewer-handoff.md lands and we swap it in.

'use client';

import { use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  PlanSolarLayout,
  ViewerSlot,
  type DesignMode,
  type MainTabId,
  type SourceId,
  type ToolId,
  type ViewMode,
} from '@/components/PlanSolarUI';
import { GeneratedHouseViewer } from '@/components/GeneratedHouseViewer';

interface Props {
  params: Promise<{ houseId: string }>;
}

const PROJECT_TITLE = 'Plan solar';
const CUSTOMER_LINE =
  'Customer request: PV Comfort · 8.50 kW Peak · Purchase · £14,000.00';
const HEADING_DEG = 18;
const PITCH_DEG = 55;
const ORIENTATION_DEG = 270;

export default function DesignPage({ params }: Props) {
  const { houseId } = use(params);
  const searchParams = useSearchParams();
  const latParam = parseFloatOrNull(searchParams.get('lat'));
  const lngParam = parseFloatOrNull(searchParams.get('lng'));
  const radiusParam = parseFloatOrNull(searchParams.get('radius'));
  const generatedMode = searchParams.get('generated') === '1';

  const [selectedTool, setSelectedTool] = useState<ToolId>('select');
  const [viewMode, setViewMode] = useState<ViewMode>('3D');
  const [source, setSource] = useState<SourceId>('google');
  const [designMode, setDesignMode] = useState<DesignMode>('building');
  const [activeTab, setActiveTab] = useState<MainTabId>('3d-planning');
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [googleEarth, setGoogleEarth] = useState(false);
  const [googleSolar, setGoogleSolar] = useState(false);

  return (
    <PlanSolarLayout
      viewer={
        generatedMode ? (
          <GeneratedHouseViewer houseId={houseId} />
        ) : (
          <ViewerSlot
            viewMode={viewMode}
            source={source}
            heading={HEADING_DEG}
            houseId={houseId}
            latOverride={latParam}
            lngOverride={lngParam}
            radiusOverride={radiusParam}
          />
        )
      }
      projectTitle={PROJECT_TITLE}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      selectedTool={selectedTool}
      onToolChange={setSelectedTool}
      source={source}
      onSourceChange={setSource}
      designMode={designMode}
      onDesignModeChange={setDesignMode}
      overflowOpen={overflowOpen}
      onOverflowToggle={() => setOverflowOpen((v) => !v)}
      rightPanelOpen={rightPanelOpen}
      onOpenRightPanel={() => setRightPanelOpen(true)}
      onCloseRightPanel={() => setRightPanelOpen(false)}
      googleEarth={googleEarth}
      googleSolar={googleSolar}
      onToggleGoogleEarth={setGoogleEarth}
      onToggleGoogleSolar={setGoogleSolar}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      heading={HEADING_DEG}
      customerLine={CUSTOMER_LINE}
      pitchDeg={PITCH_DEG}
      orientationDeg={ORIENTATION_DEG}
    />
  );
}

function parseFloatOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
