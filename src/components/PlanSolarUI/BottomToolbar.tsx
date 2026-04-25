// Bottom-left floating toolbar.
// Group 1: select / pan / ruler / marquee (+ overflow chevron)
// Group 2: pencil / fill / rectangle / grid / tree (each with a small + badge)
// Group 3: undo / redo

import {
  ChevronDownIcon,
  FillIcon,
  GridIcon,
  HandIcon,
  MarqueeIcon,
  PencilIcon,
  PlusIcon,
  PointerIcon,
  RectangleIcon,
  RedoIcon,
  RulerIcon,
  TreeIcon,
  UndoIcon,
} from './icons';
import type { ToolId } from './types';

interface BottomToolbarProps {
  selectedTool: ToolId;
  onToolChange: (tool: ToolId) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

interface ToolDef {
  id: ToolId;
  label: string;
  Icon: typeof PointerIcon;
}

const SELECTION_TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', Icon: PointerIcon },
  { id: 'pan', label: 'Pan', Icon: HandIcon },
  { id: 'ruler', label: 'Ruler', Icon: RulerIcon },
  { id: 'marquee', label: 'Marquee', Icon: MarqueeIcon },
] as const;

const DRAW_TOOLS: readonly ToolDef[] = [
  { id: 'pencil', label: 'Pencil', Icon: PencilIcon },
  { id: 'fill', label: 'Fill', Icon: FillIcon },
  { id: 'rectangle', label: 'Rectangle', Icon: RectangleIcon },
  { id: 'grid', label: 'Grid', Icon: GridIcon },
  { id: 'tree', label: 'Tree', Icon: TreeIcon },
] as const;

function ToolButton({
  tool,
  selected,
  withPlusBadge,
  onClick,
}: {
  tool: ToolDef;
  selected: boolean;
  withPlusBadge?: boolean;
  onClick: () => void;
}) {
  const { Icon, label } = tool;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={[
        'relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
        selected
          ? 'bg-[#0066ff] text-white shadow-sm'
          : 'text-gray-700 hover:bg-gray-100',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" />
      {withPlusBadge && !selected && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-gray-600 shadow ring-1 ring-gray-200">
          <PlusIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

export function BottomToolbar({
  selectedTool,
  onToolChange,
  onUndo,
  onRedo,
}: BottomToolbarProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
      {SELECTION_TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          selected={selectedTool === tool.id}
          onClick={() => onToolChange(tool.id)}
        />
      ))}
      <button
        type="button"
        aria-label="Selection options"
        className="flex h-9 w-6 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
      >
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>

      <span className="mx-1 h-6 w-px bg-gray-200" />

      {DRAW_TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          selected={selectedTool === tool.id}
          withPlusBadge
          onClick={() => onToolChange(tool.id)}
        />
      ))}

      <span className="mx-1 h-6 w-px bg-gray-200" />

      <button
        type="button"
        aria-label="Undo"
        onClick={onUndo}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100"
      >
        <UndoIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        onClick={onRedo}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100"
      >
        <RedoIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
