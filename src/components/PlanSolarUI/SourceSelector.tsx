// Source dropdown shown center-bottom: Mapbox / Google Maps / Apple Maps.

import { useState } from 'react';
import { ChevronDownIcon } from './icons';
import { SOURCE_OPTIONS, type SourceId } from './types';

interface SourceSelectorProps {
  source: SourceId;
  onSourceChange: (source: SourceId) => void;
}

export function SourceSelector({ source, onSourceChange }: SourceSelectorProps) {
  const [open, setOpen] = useState(false);
  const current = SOURCE_OPTIONS.find((opt) => opt.id === source) ?? SOURCE_OPTIONS[1];

  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-800 shadow-sm hover:bg-gray-50"
      >
        {current.label}
        <ChevronDownIcon className="h-3.5 w-3.5 text-gray-500" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onSourceChange(opt.id);
                setOpen(false);
              }}
              className={[
                'flex w-full items-center px-3 py-2 text-left text-[13px]',
                opt.id === source
                  ? 'bg-blue-50 text-[#0066ff]'
                  : 'text-gray-800 hover:bg-gray-50',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
