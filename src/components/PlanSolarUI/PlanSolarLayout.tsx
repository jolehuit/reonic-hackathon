// Composes the entire chrome around the (placeholder) viewer.
// All state is owned by the page so chrome remains controlled.

import type { ReactNode } from 'react';
import { BottomToolbar } from './BottomToolbar';
import { Compass } from './Compass';
import { Header } from './Header';
import { ModeTabs } from './ModeTabs';
import { RightPanel } from './RightPanel';
import { SaveBar } from './SaveBar';
import { SourceSelector } from './SourceSelector';
import { StatusBar } from './StatusBar';
import { TabsBar } from './TabsBar';
import { ViewModeToggle } from './ViewModeToggle';
import type {
  DesignMode,
  MainTabId,
  SourceId,
  ToolId,
  ViewMode,
} from './types';

export interface PlanSolarLayoutProps {
  // viewer slot (Cesium or placeholder)
  viewer: ReactNode;

  // header
  projectTitle: string;

  // tabs
  activeTab: MainTabId;
  onTabChange: (tab: MainTabId) => void;

  // bottom toolbar
  selectedTool: ToolId;
  onToolChange: (tool: ToolId) => void;

  // source selector
  source: SourceId;
  onSourceChange: (source: SourceId) => void;

  // mode tabs
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;

  // save / overflow
  overflowOpen: boolean;
  onOverflowToggle: () => void;

  // right panel
  rightPanelOpen: boolean;
  onOpenRightPanel: () => void;
  onCloseRightPanel: () => void;
  googleEarth: boolean;
  googleSolar: boolean;
  onToggleGoogleEarth: (next: boolean) => void;
  onToggleGoogleSolar: (next: boolean) => void;

  // floating widgets
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  heading: number;

  // status bar
  customerLine: string;
  pitchDeg: number;
  orientationDeg: number;
}

export function PlanSolarLayout(props: PlanSolarLayoutProps) {
  const {
    viewer,
    projectTitle,
    activeTab,
    onTabChange,
    selectedTool,
    onToolChange,
    source,
    onSourceChange,
    designMode,
    onDesignModeChange,
    overflowOpen,
    onOverflowToggle,
    rightPanelOpen,
    onOpenRightPanel,
    onCloseRightPanel,
    googleEarth,
    googleSolar,
    onToggleGoogleEarth,
    onToggleGoogleSolar,
    viewMode,
    onViewModeChange,
    heading,
    customerLine,
    pitchDeg,
    orientationDeg,
  } = props;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-white text-gray-900">
      <Header title={projectTitle} />
      <TabsBar activeTab={activeTab} onTabChange={onTabChange} />

      {/* Stage: viewer + floating chrome */}
      <div className="relative flex-1">
        {/* Viewer (or placeholder). It's positioned absolute -z-10 inside. */}
        {viewer}

        {/* Floating chrome layer. pointer-events-none so the viewer can be
            interacted with; individual chrome elements re-enable pointer events. */}
        <div className="pointer-events-none absolute inset-0">
          {/* Top-left: street view + 2D/3D */}
          <div className="absolute left-3 top-3">
            <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
          </div>

          {/* Top-right: compass */}
          <div className="absolute right-3 top-3">
            <Compass heading={heading} />
          </div>

          {/* Right: drawer panel */}
          <RightPanel
            open={rightPanelOpen}
            onClose={onCloseRightPanel}
            googleEarth={googleEarth}
            googleSolar={googleSolar}
            onToggleGoogleEarth={onToggleGoogleEarth}
            onToggleGoogleSolar={onToggleGoogleSolar}
          />

          {/* Bottom-left: toolbar */}
          <div className="absolute bottom-3 left-3">
            <BottomToolbar
              selectedTool={selectedTool}
              onToolChange={onToolChange}
            />
          </div>

          {/* Bottom-center: source + mode tabs */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <SourceSelector source={source} onSourceChange={onSourceChange} />
            <ModeTabs mode={designMode} onModeChange={onDesignModeChange} />
          </div>

          {/* Bottom-right: save + overflow */}
          <div className="absolute bottom-3 right-3">
            <SaveBar
              overflowOpen={overflowOpen}
              onOverflowToggle={onOverflowToggle}
              onOpenRightPanel={onOpenRightPanel}
            />
          </div>
        </div>
      </div>

      <StatusBar
        customerLine={customerLine}
        pitchDeg={pitchDeg}
        orientationDeg={orientationDeg}
      />
    </div>
  );
}
