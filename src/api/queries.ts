import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { getFolders, getSafeStatus, listEntries, searchEntries } from './endpoints';

// Ключи и опции запросов в одном месте: компоненты и инвалидация не расходятся.

export const statusQuery = queryOptions({
  queryKey: ['status'],
  queryFn: getSafeStatus,
});

export const foldersQuery = queryOptions({
  queryKey: ['folders'],
  queryFn: getFolders,
});

export const listingQuery = (folderId: number | null) =>
  queryOptions({
    queryKey: ['listing', folderId],
    queryFn: () => listEntries(folderId),
  });

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['search', q],
    queryFn: () => searchEntries(q),
  });

/** После импорта/переименования/удаления: листинги, дерево, счётчик, поиск. */
export function invalidateContent(qc: QueryClient): void {
  for (const key of ['listing', 'folders', 'status', 'search']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
