import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_SELECTION, pruneSelection, rangeBetween, stepIndex } from '../lib/selection';
import type { NavKey, Selection } from '../lib/selection';

/**
 * Выделение карточек текущего вида (UF-9): Ctrl+клик/чекбокс, Shift+клик,
 * Ctrl+A, стрелки (и Shift+стрелки). visibleIds — порядок карточек; выделение всегда
 * подмножество видимого (см. pruneSelection).
 */
export function useSelection(visibleIds: readonly number[]) {
  const [selected, setSelected] = useState<Selection>(EMPTY_SELECTION);
  const anchor = useRef<number | null>(null);
  const cursor = useRef<number | null>(null); // конец диапазона Shift+стрелок

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
    cursor.current = id;
  }, []);

  const only = useCallback((id: number) => {
    setSelected(new Set([id]));
    anchor.current = id;
    cursor.current = id;
  }, []);

  const extendTo = useCallback(
    (id: number) => {
      setSelected(new Set(rangeBetween(visibleIds, anchor.current, id)));
      if (anchor.current === null || !visibleIds.includes(anchor.current)) anchor.current = id;
      cursor.current = id;
    },
    [visibleIds],
  );

  const selectAll = useCallback(() => setSelected(new Set(visibleIds)), [visibleIds]);

  /** Рамка выделения (UF-9): заменить выделение набором; якорь - первая карточка набора. */
  const replace = useCallback((ids: readonly number[]) => {
    setSelected(new Set(ids));
    const [first] = ids;
    anchor.current = first ?? null;
    cursor.current = first ?? null;
  }, []);

  const clear = useCallback(() => {
    setSelected(EMPTY_SELECTION);
    anchor.current = null;
    cursor.current = null;
  }, []);

  /**
   * Стрелки/Home/End в сетке из columns колонок: одиночное выделение соседней
   * карточки, с extend (Shift) - диапазон от якоря. Возвращает id цели.
   */
  const move = useCallback(
    (key: NavKey, columns = 1, extend = false): number | undefined => {
      // текущая - последняя «тронутая»: при одиночном выделении она же, при диапазоне - его конец
      const cursorId = selected.size === 1 ? [...selected][0] : cursor.current;
      const current = cursorId === undefined || cursorId === null ? -1 : visibleIds.indexOf(cursorId);
      const target = visibleIds[stepIndex(visibleIds.length, current, key, columns)];
      if (target === undefined) return undefined;
      if (extend) {
        if (anchor.current === null || !visibleIds.includes(anchor.current)) anchor.current = cursorId ?? target;
        setSelected(new Set(rangeBetween(visibleIds, anchor.current, target)));
        cursor.current = target;
      } else only(target);
      return target;
    },
    [selected, visibleIds, only],
  );

  return { selected, toggle, only, extendTo, selectAll, replace, clear, move };
}
