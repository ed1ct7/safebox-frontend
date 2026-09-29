import { useMemo, useRef } from 'react';
import type { DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import type { Entry } from '../api/types';
import type { EntryCardHandlers } from '../components/EntryCard';
import type { TreeDrop } from '../components/FolderTree';
import { canMoveTo, dragIdsFor, DRAG_MIME } from '../lib/move';
import type { Selection } from '../lib/selection';
import { subtreeIds } from '../lib/tree';
import { useEvent } from './useEvent';

/**
 * Перетаскивание карточек (UF-14): одной или всех выделенных - на карточку папки
 * или записи (станет вложением) и на узел дерева. Что тащим, известно только
 * здесь: во время dragover браузер прячет данные переноса, отдаёт лишь типы.
 */
export function useEntryDnd({
  entries,
  selected,
  onMove,
}: {
  entries: readonly Entry[]; // карточки текущего вида в порядке показа
  selected: Selection;
  onMove: (moving: Entry[], parentId: number | null) => void;
}) {
  const qc = useQueryClient();
  const drag = useRef<{ ids: number[]; blocked: ReadonlySet<number> } | null>(null);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const dragStart = useEvent((e: DragEvent, entry: Entry) => {
    const ids = dragIdsFor(
      entries.map((en) => en.id),
      selected,
      entry.id,
    );
    // в себя и в свои подпапки нельзя: считаем один раз, а не на каждый dragover
    const folders = qc.getQueryData(foldersQuery.queryKey)?.folders ?? [];
    drag.current = { ids, blocked: subtreeIds(folders, ids) };
    e.dataTransfer.setData(DRAG_MIME, ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
  });

  const dragEnd = useEvent(() => {
    drag.current = null;
  });

  const canDrop = useEvent((target: number | null) => {
    const d = drag.current;
    if (d === null) return false;
    return canMoveTo(d.ids, target, d.blocked, (id) => byId.get(id)?.parentId);
  });

  const drop = useEvent((target: number | null) => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (!canMoveTo(d.ids, target, d.blocked, (id) => byId.get(id)?.parentId)) return;
    const moving = d.ids.flatMap((id) => byId.get(id) ?? []);
    if (moving.length > 0) onMove(moving, target);
  });

  return useMemo(
    () => ({
      card: {
        onDragStart: dragStart,
        onDragEnd: dragEnd,
        canDropOn: (entry: Entry) => canDrop(entry.id),
        onDropOn: (entry: Entry) => drop(entry.id),
      } satisfies Pick<EntryCardHandlers, 'onDragStart' | 'onDragEnd' | 'canDropOn' | 'onDropOn'>,
      tree: { canDrop, onDrop: drop } satisfies TreeDrop,
    }),
    [dragStart, dragEnd, canDrop, drop],
  );
}
