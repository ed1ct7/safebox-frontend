import { useSyncExternalStore } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry } from '../api/types';

// Миниатюра живёт по одному и тому же адресу, а заменяется на месте: импорт с заменой,
// «Обновить предпросмотр». Адрес получает версию, иначе <img> не перезагрузится.
// Замена при импорте меняет modifiedAt записи; обновление предпросмотра может его
// не менять - тогда версию сдвигает bumpThumbnail.
const revisions = new Map<number, number>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Миниатюра записи заменена на сервере: карточки и панель перезагрузят картинку. */
export function bumpThumbnail(id: number): void {
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  for (const listener of listeners) listener();
}

export function useThumbnailSrc(entry: Pick<Entry, 'id' | 'modifiedAt'>): string {
  const rev = useSyncExternalStore(subscribe, () => revisions.get(entry.id) ?? 0);
  return `${mediaUrl(entry.id, 'thumbnail')}?v=${entry.modifiedAt}.${rev}`;
}
