// Bottom-right Save button + overflow menu.

import { MoreIcon } from './icons';

interface SaveBarProps {
  onSave?: () => void;
  overflowOpen: boolean;
  onOverflowToggle: () => void;
  onOpenRightPanel: () => void;
}

const OVERFLOW_ITEMS: readonly { id: string; label: string; action?: 'open-right-panel' }[] = [
  { id: 'previews', label: 'Change previews' },
  { id: 'location', label: 'Show Location Marker' },
  { id: '3d-data', label: '3D data', action: 'open-right-panel' },
  { id: 'custom-images', label: 'Custom Images' },
  { id: 'mcs-sunpath', label: 'MCS Sunpath Diagram' },
  { id: 'shading', label: 'Shading Beta' },
] as const;

export function SaveBar({
  onSave,
  overflowOpen,
  onOverflowToggle,
  onOpenRightPanel,
}: SaveBarProps) {
  return (
    <div className="pointer-events-auto relative flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        className="flex h-9 items-center gap-2 rounded-xl bg-[#0066ff] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0058e0]"
      >
        Save
        <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-medium">
          ⌘S
        </span>
      </button>
      <button
        type="button"
        aria-label="More options"
        onClick={onOverflowToggle}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <MoreIcon className="h-4 w-4" />
      </button>

      {overflowOpen && (
        <div
          role="menu"
          data-testid="overflow-menu"
          className="absolute bottom-full right-0 z-30 mb-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {OVERFLOW_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                if (item.action === 'open-right-panel') {
                  onOpenRightPanel();
                }
                onOverflowToggle();
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
