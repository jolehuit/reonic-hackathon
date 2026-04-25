// Bottom status bar.
// Left: customer request summary.
// Right: pitch / orientation + thumbs / chat / share icons.

import { ChatIcon, InfoIcon, ShareIcon, ThumbsUpIcon } from './icons';

interface StatusBarProps {
  customerLine: string;
  pitchDeg: number;
  orientationDeg: number;
}

export function StatusBar({ customerLine, pitchDeg, orientationDeg }: StatusBarProps) {
  return (
    <footer className="pointer-events-auto flex h-9 w-full items-center justify-between border-t border-gray-200 bg-white px-4 text-[12px] text-gray-700">
      <div className="truncate">{customerLine}</div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-gray-600">
          <InfoIcon className="h-3.5 w-3.5" />
          <span>
            {pitchDeg}° Roof pitch · {orientationDeg}° Orientation
          </span>
        </div>
        <div className="ml-2 flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Thumbs"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ThumbsUpIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Chat"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChatIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Share"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ShareIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </footer>
  );
}
