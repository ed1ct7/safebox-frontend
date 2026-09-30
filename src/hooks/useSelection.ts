import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_SELECTION, pruneSelection, rangeBetween, stepIndex } from '../lib/selection';
import type { NavKey, Selection } from '../lib/selection';

/**
 * Выделение карточек текущего вида (UF-9): Ctrl+клик/чекбокс, Shift+клик,
 * Ctrl+A, стрелки. visibleIds — порядок карточек; выделение всегда
 * подмножество видимого (см. pruneSelection).
 */
export function useSelection(visibleIds: readonly number[]) {
  const [selected, setSelected] = useState<Selection>(EMPTY_SELECTION);
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, visibleIds));
  }, [visibleIds]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);

  const only = useCallback((id: number) => {
    setSelected(new Set([id]));
    anchor.current = id;
  }, []);

  const extendTo = useCallback(
    (id: number) => {
      setSelected(new Set(rangeBetween(visibleIds, anchor.current, id)));
      if (anchor.current === null || !visibleIds.includes(anchor.current)) anchor.current = id;
    },
    [visibleIds],
  );

  const selectAll = useCallback(() => setSelected(new Set(visibleIds)), [visibleIds]);

  /** Рамка выделения (UF-9): заменить выделение набором; якорь - первая карточка набора. */
  const replace = useCallback((ids: readonly number[]) => {
    setSelected(new Set(ids));
    const [first] = ids;
    anchor.current = first ?? null;
  }, []);

  const clear = useCallback(() => {
    setSelected(EMPTY_SELECTION);
    anchor.current = null;
  }, []);

  /** Стрелки/Home/End: одиночное выделение соседней карточки. */
  const move = useCallback(
    (key: NavKey) => {
      const current = selected.size === 1 ? visibleIds.indexOf([...selected][0] ?? -1) : -1;
      const target = visibleIds[stepIndex(visibleIds.length, current, key)];
      if (target !== undefined) only(target);
    },
    [selected, visibleIds, only],
  );

  return { selected, toggle, only, extendTo, selectAll, replace, clear, move };
}
