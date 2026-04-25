// Top header: project title (left) + action buttons (right).

import {
  CloseIcon,
  FilesIcon,
  ImagesIcon,
  NotesIcon,
  PlusIcon,
  TasksIcon,
} from './icons';

interface HeaderProps {
  title: string;
  onClose?: () => void;
}

interface ActionButton {
  id: string;
  label: string;
  Icon: typeof ImagesIcon;
}

const ACTIONS: readonly ActionButton[] = [
  { id: 'images', label: 'Images', Icon: ImagesIcon },
  { id: 'notes', label: 'Notes', Icon: NotesIcon },
  { id: 'files', label: 'Files', Icon: FilesIcon },
  { id: 'tasks', label: 'Tasks', Icon: TasksIcon },
] as const;

export function Header({ title, onClose }: HeaderProps) {
  return (
    <header className="pointer-events-auto flex h-14 w-full items-center justify-between border-b border-gray-200 bg-white px-5">
      <div className="flex items-center gap-2">
        <h1 className="text-[15px] font-semibold tracking-tight text-gray-900">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        {ACTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-100"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
        <div className="mx-1 h-6 w-px bg-gray-200" />
        <button
          type="button"
          aria-label="Add"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
