// Right side drawer (3D Models / Photogrammetry / Google Earth / Google Solar).
// Shown when the user picks "3D data" from the SaveBar overflow menu.

import { CloseIcon, UploadIcon } from './icons';

interface RightPanelProps {
  open: boolean;
  onClose: () => void;
  googleEarth: boolean;
  googleSolar: boolean;
  onToggleGoogleEarth: (next: boolean) => void;
  onToggleGoogleSolar: (next: boolean) => void;
}

function Toggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      className={[
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        value ? 'bg-[#0066ff]' : 'bg-gray-300',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-4' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}

export function RightPanel({
  open,
  onClose,
  googleEarth,
  googleSolar,
  onToggleGoogleEarth,
  onToggleGoogleSolar,
}: RightPanelProps) {
  if (!open) return null;
  return (
    <aside
      data-testid="right-panel"
      className="pointer-events-auto absolute right-3 top-3 z-20 flex w-80 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-gray-900">3D Models</h2>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </header>

      <button
        type="button"
        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-gray-600 transition-colors hover:border-[#0066ff] hover:bg-blue-50/40"
      >
        <UploadIcon className="h-5 w-5 text-gray-500" />
        <span className="text-[13px] font-medium">Drop files or click here</span>
        <span className="text-[11px] text-gray-500">.glb, .gltf, .obj up to 50 MB</span>
      </button>

      <div className="mt-1 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
        <div>
          <div className="text-[13px] font-medium text-gray-900">Photogrammetry</div>
          <div className="text-[11px] text-gray-500">Reality capture mesh</div>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
        >
          Import
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
        <div>
          <div className="text-[13px] font-medium text-gray-900">Google Earth</div>
          <div className="text-[11px] text-gray-500">3D Photorealistic Tiles</div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          <span>{googleEarth ? 'Yes' : 'No'}</span>
          <Toggle
            value={googleEarth}
            onChange={onToggleGoogleEarth}
            ariaLabel="Toggle Google Earth"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
        <div>
          <div className="text-[13px] font-medium text-gray-900">Google Solar</div>
          <div className="text-[11px] text-gray-500">Solar API roof segments</div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          <span>{googleSolar ? 'Yes' : 'No'}</span>
          <Toggle
            value={googleSolar}
            onChange={onToggleGoogleSolar}
            ariaLabel="Toggle Google Solar"
          />
        </div>
      </div>
    </aside>
  );
}
