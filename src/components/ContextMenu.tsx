import { useLayoutEffect, useMemo, useState } from 'react';
import type { Entry } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { menuItemsFor } from '../lib/menu';
import type { MenuAction } from '../lib/menu';

export interface ContextMenuState {
  x: number;
  y: number;
  entry: Entry;
}

const MARGIN = 8;

/**
 * UF-10: правый клик - Открыть / Открыть вложения / Скачать / Скачать вложения /
 * Свойства / Переименовать / Переместить… / Теги… / Удалить; у ссылки (UF-6) ещё
 * «Копировать адрес» и «Обновить предпросмотр». Набор пунктов - lib/menu.
 */
export function ContextMenu({
  state,
  onClose,
  onAction,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: MenuAction, entry: Entry) => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  const { entry } = state;
  const items = useMemo(() => menuItemsFor(entry), [entry]);
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
          key={item.action}
          type="button"
          role="menuitem"
          className={`flex w-full items-center justify-between gap-6 px-4 py-1.5 text-left text-sm transition hover:bg-zinc-800 ${
            item.danger === true ? 'text-red-300' : 'text-zinc-200'
          } ${item.separatorBefore === true ? 'mt-1 border-t border-zinc-800 pt-2' : ''}`}
          onClick={() => {
            onClose();
            onAction(item.action, entry);
          }}
        >
          {item.label}
          {item.hint !== undefined && <span className="text-xs text-zinc-500">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
