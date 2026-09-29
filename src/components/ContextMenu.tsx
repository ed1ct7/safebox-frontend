import { useLayoutEffect, useState } from 'react';
import type { Entry } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';

export interface ContextMenuState {
  x: number;
  y: number;
  entry: Entry;
}

const MARGIN = 8;

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
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // не даём меню вылезти за край окна: меряем после отрисовки
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(state.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(state.y, window.innerHeight - height - MARGIN)),
    });
  }, [ref, state.x, state.y]);

  const items: { label: string; action: () => void; danger?: boolean }[] = [
    { label: 'Открыть', action: () => onOpen(entry) },
    ...(entry.kind === 'link' ? [] : [{ label: 'Скачать', action: () => onDownload(entry) }]),
    { label: 'Переименовать', action: () => onRename(entry) },
    { label: 'Удалить', action: () => onDelete(entry), danger: true },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-50 min-w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
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
