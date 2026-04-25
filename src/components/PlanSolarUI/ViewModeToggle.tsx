// Top-left floating: Street View placeholder + 2D / 3D toggle.

import { PersonIcon } from './icons';
import type { ViewMode } from './types';

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ viewMode, onViewModeChange }: ViewModeToggleProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <button
        type="button"
        aria-label="Street view"
        className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm hover:bg-gray-50"
      >
        <PersonIcon className="h-5 w-5 text-gray-700" />
      </button>
      <div className="inline-flex items-center rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {(['2D', '3D'] as const).map((mode) => {
          const isActive = mode === viewMode;
          return (
            <button
              key={mode}
              type="button"
              data-testid={`viewmode-${mode}`}
              onClick={() => onViewModeChange(mode)}
              aria-pressed={isActive}
              className={[
                'rounded-xl px-3 py-1 text-[12px] font-semibold transition-colors',
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100',
              ].join(' ')}
            >
              {mode}
            </button>
          );
        })}
      </div>
    </div>
  );
}
