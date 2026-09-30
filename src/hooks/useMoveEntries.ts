import { useCallback } from 'react';
import { listEntries, moveEntries, planMove, updateEntry } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import type { ConflictPolicy, Entry, MoveConflict } from '../api/types';
import { useToast } from '../components/Toasts';
import { moveConflictItems, resolutionsToRecord } from '../lib/conflicts';
import { foldForSearch } from '../lib/fold';
import { moveSummary } from '../lib/format';
import { withSuffix } from '../lib/uniqueNames';
import type { AskConflicts } from './useConflictPrompt';
import { useEvent } from './useEvent';

const RENAME_ROUNDS = 5; // защита от неожиданных повторных совпадений имён

/**
 * «Оставить оба»: лежащие в папке назначения получают «имя (2)», «имя (3)»…,
 * переносимое сохраняет имена. Имена-соседи берутся из листинга папки, приписки
 * не сталкиваются ни с соседями, ни друг с другом. Ошибка - тост, false.
 */
async function renameExistingAside(
  conflicts: readonly MoveConflict[],
  parentId: number | null,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const listing = await listEntries(parentId);
  const taken = new Set(listing.entries.map((e) => foldForSearch(e.name)));
  const renames = new Map<number, string>();
  for (const c of conflicts) {
    const ex = c.existing;
    if (renames.has(ex.id)) continue; // несколько переносимых об один и тот же лежащий
    let n = 2;
    let candidate = withSuffix(ex.name, n);
    while (taken.has(foldForSearch(candidate))) {
      n += 1;
      candidate = withSuffix(ex.name, n);
    }
    taken.add(foldForSearch(candidate));
    renames.set(ex.id, candidate);
  }
  for (const [id, name] of renames) {
    try {
      await updateEntry(id, { name });
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, `Не удалось переименовать «${name}»`), 'error');
      return false;
    }
  }
  return true;
}

/**
 * Перемещение записей к новому родителю - папке, «Все объекты» или записи, у
 * которой они станут вложениями (UF-14). Сначала план: занятые имена решает
 * пользователь тем же диалогом, что и при импорте (отмена - ничего не
 * меняется); «Оставить оба» переименовывает лежащие в папке («имя (2)»…) и
 * спрашивает план заново; «в себя/потомка» сервер отклоняет 422 - причина
 * уходит тостом. onDone(moved) вызывается всегда: список пора обновить,
 * выделение - снять, если moved.
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
        let resolutions: Record<string, ConflictPolicy> | undefined;
        for (let round = 0; ; round += 1) {
          const plan = await planMove(ids, parentId);
          if (plan.conflicts.length === 0) break;
          const answer = await ask({
            kind: 'move',
            items: moveConflictItems(plan.conflicts, moving),
          });
          if (answer === null) return;
          if (answer !== 'rename-existing') {
            resolutions = resolutionsToRecord(answer);
            break;
          }
          if (round >= RENAME_ROUNDS) {
            toast('Слишком много совпадений имён — разрешите их по одному', 'error');
            return;
          }
          if (!(await renameExistingAside(plan.conflicts, parentId, toast))) return;
          // имена лежащих освободились - план заново, конфликтов больше не будет
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
