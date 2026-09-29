import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  getEntry,
  getFolders,
  getSafeStatus,
  getSettings,
  getTags,
  listEntries,
  searchEntries,
} from './endpoints';
import type { SearchOptions } from './endpoints';
import type { Entry } from './types';

// Ключи и опции запросов в одном месте: компоненты и инвалидация не расходятся.

export const statusQuery = queryOptions({
  queryKey: ['status'],
  queryFn: getSafeStatus,
});

export const foldersQuery = queryOptions({
  queryKey: ['folders'],
  queryFn: getFolders,
});

/** Как часто перечитывать видимое, пока у ссылок грузится предпросмотр (UF-21). */
export const PREVIEW_POLL_MS = 2000;

/** Есть ли среди записей ссылка, чей предпросмотр ещё в очереди. */
export function hasPendingPreview(entries: readonly Pick<Entry, 'previewPending'>[] | undefined): boolean {
  return entries?.some((e) => e.previewPending === true) ?? false;
}

/** folderId — любая запись: открытые вложения листаются так же, как папка. */
export const listingQuery = (folderId: number | null) =>
  queryOptions({
    queryKey: ['listing', folderId],
    queryFn: () => listEntries(folderId),
    // опрос идёт, пока в листинге есть previewPending, и сам прекращается
    refetchInterval: (query) => (hasPendingPreview(query.state.data?.entries) ? PREVIEW_POLL_MS : false),
  });

export const entryQuery = (id: number) =>
  queryOptions({
    queryKey: ['entry', id],
    queryFn: () => getEntry(id),
  });

export const searchQuery = (q: string, opts: SearchOptions = {}) =>
  queryOptions({
    queryKey: ['search', q, opts],
    queryFn: () => searchEntries(q, opts),
    refetchInterval: (query) =>
      hasPendingPreview(query.state.data?.results.map((h) => h.entry)) ? PREVIEW_POLL_MS : false,
  });

export const tagsQuery = queryOptions({
  queryKey: ['tags'],
  queryFn: getTags,
});

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: getSettings,
});

/** После импорта/переименования/перемещения/удаления: листинги, дерево, счётчик, поиск, счётчики тегов. */
export function invalidateContent(qc: QueryClient): void {
  for (const key of ['listing', 'folders', 'status', 'search', 'tags', 'entry']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/** После смены тегов: карточки и результаты фильтра показывают теги, экран «Теги» — счётчики. */
export function invalidateTags(qc: QueryClient): void {
  for (const key of ['tags', 'listing', 'search', 'entry']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
