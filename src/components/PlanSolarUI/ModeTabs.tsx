// Center-bottom segmented control: Building / Modules / Strings.

import type { DesignMode } from './types';

interface ModeTabsProps {
  mode: DesignMode;
  onModeChange: (mode: DesignMode) => void;
}

const MODES: readonly { id: DesignMode; label: string }[] = [
  { id: 'building', label: 'Building' },
  { id: 'modules', label: 'Modules' },
  { id: 'strings', label: 'Strings' },
] as const;

export function ModeTabs({ mode, onModeChange }: ModeTabsProps) {
  return (
    <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
      {MODES.map((m) => {
        const isActive = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            aria-pressed={isActive}
            className={[
              'rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-700 hover:bg-gray-100',
            ].join(' ')}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
