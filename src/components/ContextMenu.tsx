import type { Entry } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';

export interface ContextMenuState {
  x: number;
  y: number;
  entry: Entry;
}

/** UF-10: правый клик — Открыть / Скачать / Переименовать / Удалить. */
export function ContextMenu({
  state,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onDelete,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onOpen: (entry: Entry) => void;
  onDownload: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  const { entry } = state;

  const items: { label: string; action: () => void; danger?: boolean; hidden?: boolean }[] = [
    { label: 'Открыть', action: () => onOpen(entry) },
    {
      label: 'Скачать',
      action: () => onDownload(entry),
      hidden: entry.kind === 'link',
    },
    { label: 'Переименовать', action: () => onRename(entry) },
    { label: 'Удалить', action: () => onDelete(entry), danger: true },
  ];

  return (
    <div
      ref={ref}
      style={{
        left: Math.min(state.x, window.innerWidth - 230),
        top: Math.min(state.y, window.innerHeight - 200),
      }}
      className="fixed z-50 min-w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
    >
      {items
        .filter((i) => !i.hidden)
        .map((item) => (
          <button
            key={item.label}
            className={`block w-full px-4 py-1.5 text-left text-sm transition hover:bg-zinc-800 ${
              item.danger === true ? 'text-red-300' : 'text-zinc-200'
            }`}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            {item.label}
          </button>
        ))}
    </div>
  );
}
