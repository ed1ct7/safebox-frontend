import type { Selection } from './selection';

// Перетаскивание карточек на папку, запись или узел дерева (UF-14).
// Чистая логика: тестируется без DOM.

/** Тип данных внутреннего drag&drop: отличает перенос карточек от файлов из проводника. */
export const DRAG_MIME = 'application/x-safebox-entries';

/**
 * Что тащим: потянули выделенную карточку — все выделенные (в порядке карточек),
 * невыделенную — только её, выделение не трогаем (как в проводнике).
 */
export function dragIdsFor(
  visibleIds: readonly number[],
  selected: Selection,
  dragged: number,
): number[] {
  if (!selected.has(dragged)) return [dragged];
  return visibleIds.filter((id) => selected.has(id));
}

/**
 * Можно ли бросить ids на target (null — корень «Все объекты»). blocked — сами
 * записи и папки их поддерева; хоть одна запись должна менять родителя, иначе
 * перемещать нечего. Вложенность через вложения проверяет сервер (422).
 */
export function canMoveTo(
  ids: readonly number[],
  target: number | null,
  blocked: ReadonlySet<number>,
  parentOf: (id: number) => number | null | undefined,
): boolean {
  if (ids.length === 0) return false;
  if (target !== null && blocked.has(target)) return false;
  return ids.some((id) => parentOf(id) !== target);
}
