// Lightweight inline SVG icons. Avoids extra deps and keeps bundle small.
// Stroke-based monochrome icons styled via currentColor.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PointerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3l14 6-6.5 2.2L10 19 5 3z" />
    </svg>
  );
}

export function HandIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 11V5a1.5 1.5 0 1 1 3 0v5" />
      <path d="M12 10V3.5a1.5 1.5 0 1 1 3 0V11" />
      <path d="M15 11V5a1.5 1.5 0 1 1 3 0v8" />
      <path d="M18 13v3a5 5 0 0 1-5 5h-1.5a4 4 0 0 1-3.6-2.3L6 16l-1.5-3a1.5 1.5 0 0 1 2.6-1.5L9 14V7.5a1.5 1.5 0 1 1 3 0V11" />
    </svg>
  );
}

export function RulerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 16.5L16.5 3l4.5 4.5L7.5 21 3 16.5z" />
      <path d="M7 13l1.5 1.5M9 11l2 2M11 9l1.5 1.5M13 7l2 2" />
    </svg>
  );
}

export function MarqueeIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeDasharray="2 2">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" />
    </svg>
  );
}

export function FillIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 13l7-7 7 7-7 7-7-7z" />
      <path d="M19 17c0 1.5 1 2.5 2 2.5" />
    </svg>
  );
}

export function RectangleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 10h16M4 16h16M10 4v16M16 4v16" />
    </svg>
  );
}

export function TreeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l5 7h-3l4 6h-4l3 5H7l3-5H6l4-6H7l5-7z" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ImagesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="14" height="11" rx="1.5" />
      <path d="M7 9.5l3 3 2-2 4 4" />
      <path d="M7 19h12a2 2 0 0 0 2-2V9" />
    </svg>
  );
}

export function NotesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 9h7M8 13h7M8 17h5" />
    </svg>
  );
}

export function FilesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function TasksIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-4 4.5-6 7-6s6 2 7 6" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export function ThumbsUpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 11v9H4v-9h3z" />
      <path d="M7 11l4-7c1.5 0 2.5 1 2.5 2.5V10h5a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7H7" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5h16v11H8l-4 4V5z" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 11l7.6-4M8.2 13l7.6 4" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 17v3h14v-3" />
    </svg>
  );
}
