// Sub-header tab bar: Checklist (left) + main tabs (right).

import { CheckCircleIcon, MoreIcon, PlusIcon } from './icons';
import type { MainTabId } from './types';

interface MainTab {
  id: MainTabId | 'add-components-marker';
  label: string;
  hasMarker?: boolean;
}

interface TabsBarProps {
  activeTab: MainTabId;
  onTabChange: (tab: MainTabId) => void;
}

const TABS: readonly { id: MainTabId; label: string; marker?: 'circle' }[] = [
  { id: '3d-planning', label: '3D Planning' },
  { id: 'add-components', label: 'Add components', marker: 'circle' },
  { id: 'payment', label: 'Payment' },
  { id: 'parts-list', label: 'Parts list' },
] as const;

export function TabsBar({ activeTab, onTabChange }: TabsBarProps) {
  return (
    <div className="pointer-events-auto flex h-11 w-full items-center justify-between border-b border-gray-200 bg-white px-5">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-gray-100"
      >
        <CheckCircleIcon className="h-4 w-4 text-gray-400" />
        Checklist
      </button>

      <nav className="flex items-center gap-1">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={[
                'relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'text-gray-900'
                  : 'text-gray-500 hover:text-gray-800',
              ].join(' ')}
            >
              {tab.marker === 'circle' && (
                <span className="h-2 w-2 rounded-full border border-gray-400" />
              )}
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#0066ff]" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="More tabs"
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <MoreIcon className="h-4 w-4" />
        </button>
        <div className="mx-1 h-6 w-px bg-gray-200" />
        <button
          type="button"
          aria-label="Add tab"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
}
