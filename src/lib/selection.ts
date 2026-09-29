// Чистая логика выделения карточек (UF-9): тестируется без React.

export type Selection = ReadonlySet<number>;

export const EMPTY_SELECTION: Selection = new Set<number>();

/**
 * Выделение только из видимых карточек. Без этого после смены поиска/папки
 * в выделении оставались бы невидимые записи — и Delete удалил бы их.
 * Возвращает тот же объект, если ничего не изменилось (без лишних рендеров).
 */
export function pruneSelection(sel: Selection, visible: readonly number[]): Selection {
  if (sel.size === 0) return sel;
  const visibleSet = new Set(visible);
  let changed = false;
  for (const id of sel) {
    if (!visibleSet.has(id)) {
      changed = true;
      break;
    }
  }
  if (!changed) return sel;
  return new Set([...sel].filter((id) => visibleSet.has(id)));
}

/** Shift+клик: диапазон от якоря до цели в порядке карточек. */
export function rangeBetween(ids: readonly number[], anchor: number | null, target: number): number[] {
  const b = ids.indexOf(target);
  if (b === -1) return [];
  const a = anchor === null ? -1 : ids.indexOf(anchor);
  if (a === -1) return [target];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return ids.slice(lo, hi + 1);
}

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function isNavKey(key: string): key is NavKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End';
}

/** Индекс карточки после стрелки/Home/End; current = -1 — ничего не выбрано. */
export function stepIndex(length: number, current: number, key: NavKey): number {
  if (length === 0) return -1;
  const last = length - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (current < 0) return key === 'ArrowRight' ? 0 : last;
  return key === 'ArrowRight' ? Math.min(current + 1, last) : Math.max(current - 1, 0);
}
