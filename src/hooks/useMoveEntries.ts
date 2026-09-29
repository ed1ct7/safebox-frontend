import { useCallback } from 'react';
import { moveEntries, planMove } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import type { ConflictPolicy, Entry } from '../api/types';
import { useToast } from '../components/Toasts';
import { moveConflictItems, resolutionsToRecord } from '../lib/conflicts';
import { moveSummary } from '../lib/format';
import type { AskConflicts } from './useConflictPrompt';
import { useEvent } from './useEvent';

/**
 * Перемещение записей к новому родителю - папке, «Все объекты» или записи, у
 * которой они станут вложениями (UF-14). Сначала план: занятые имена решает
 * пользователь тем же диалогом, что и при импорте (отмена - ничего не
 * меняется); «в себя/потомка» сервер отклоняет 422 - причина уходит тостом.
 * onDone(moved) вызывается всегда: список пора обновить, выделение - снять, если moved.
 */
export function useMoveEntries({
  askConflicts,
  onDone,
}: {
  askConflicts: AskConflicts;
  onDone: (moved: boolean) => void;
}) {
  const toast = useToast();
  const ask = useEvent(askConflicts);
  const done = useEvent(onDone);

  return useCallback(
    async (moving: Entry[], parentId: number | null): Promise<void> => {
      const ids = moving.map((e) => e.id);
      let moved = false;
      try {
        const plan = await planMove(ids, parentId);
        let resolutions: Record<string, ConflictPolicy> | undefined;
        if (plan.conflicts.length > 0) {
          const answer = await ask({
            kind: 'move',
            items: moveConflictItems(plan.conflicts, moving),
          });
          if (answer === null) return;
          resolutions = resolutionsToRecord(answer);
        }
        const result = await moveEntries(ids, parentId, resolutions);
        moved = true;
        const summary = moveSummary(result);
        toast(summary.text, summary.kind);
      } catch (e) {
        if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось переместить'), 'error');
      } finally {
        done(moved);
      }
    },
    [ask, done, toast],
  );
}
