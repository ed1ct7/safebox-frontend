import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  getEntry,
  getFolders,
  getSafeStatus,
  getSettings,
  getTags,
  listEntries,
  listTrash,
  searchEntries,
} from './endpoints';
import type { SearchOptions } from './endpoints';
import type { Entry, Listing, SearchResponse } from './types';

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

// ── Постраничная выдача (К2) ────────────────────────────────────────────────
// Первая страница маленькая - экран появляется сразу; остальные догружаются
// подряд крупными (MainShell, useAllPages), сетка рисует только видимое.

export const FIRST_PAGE = 200;
export const NEXT_PAGE = 2000;

const pageLimit = (offset: number) => (offset === 0 ? FIRST_PAGE : NEXT_PAGE);

/** Смещение следующей страницы; undefined - всё загружено (или сервер без total отдал всё сразу). */
export function nextOffset(loaded: number, lastCount: number, total: number | undefined): number | undefined {
  if (total === undefined || lastCount === 0 || loaded >= total) return undefined;
  return loaded;
}

/** Склеить страницы; запись, сдвинувшаяся между запросами на границу страниц, не повторяется. */
function uniqueBy<T>(items: T[], id: (t: T) => number): T[] {
  const seen = new Set<number>();
  return items.filter((t) => {
    const k = id(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Что сказали страницы вместе: сколько всего, всё ли загружено, не поменялась ли выдача на ходу. */
interface PagesState {
  total: number;
  /** загружено всё (следующей страницы нет); иначе - догружается */
  complete: boolean;
  /**
   * Выдача поменялась между запросами страниц (у страниц разный total, запись
   * сдвинулась на границу и повторилась, или загружено не столько, сколько total):
   * могли пропасть или задвоиться записи - нужно перечитать (useAllPages).
   */
  stale: boolean;
}

function pagesState(pages: readonly { total?: number; count: number }[], unique: number): PagesState {
  const last = pages.at(-1);
  const raw = pages.reduce((n, p) => n + p.count, 0);
  const total = last?.total ?? unique;
  const complete = last === undefined || nextOffset(raw, last.count, last.total) === undefined;
  const stale =
    unique !== raw ||
    pages.some((p) => p.total !== undefined && p.total !== last?.total) ||
    (complete && unique !== total);
  return { total: Math.max(total, unique), complete, stale };
}

export interface PagedListing extends Listing, PagesState {
  total: number;
}

export function mergeListing(data: InfiniteData<Listing, number>): PagedListing {
  const [first] = data.pages;
  const entries = uniqueBy(
    data.pages.flatMap((p) => p.entries),
    (e) => e.id,
  );
  return {
    parent: first?.parent ?? null,
    path: first?.path ?? [],
    entries,
    ...pagesState(
      data.pages.map((p) => ({ total: p.total, count: p.entries.length })),
      entries.length,
    ),
  };
}

export interface PagedSearch extends SearchResponse, PagesState {
  total: number;
}

export function mergeSearch(data: InfiniteData<SearchResponse, number>): PagedSearch {
  const results = uniqueBy(
    data.pages.flatMap((p) => p.results),
    (h) => h.entry.id,
  );
  return {
    query: data.pages[0]?.query ?? '',
    results,
    ...pagesState(
      data.pages.map((p) => ({ total: p.total, count: p.results.length })),
      results.length,
    ),
  };
}

const loadedListing = (pages: Listing[]) => pages.reduce((n, p) => n + p.entries.length, 0);
const loadedSearch = (pages: SearchResponse[]) => pages.reduce((n, p) => n + p.results.length, 0);

/**
 * folderId — любая запись: открытые вложения листаются так же, как папка.
 * Предпросмотры ссылок опрашиваются точечно (usePreviewPoll), а не перечитыванием папки.
 */
export const listingQuery = (folderId: number | null) =>
  infiniteQueryOptions({
    queryKey: ['listing', folderId],
    queryFn: ({ pageParam }) => listEntries(folderId, { offset: pageParam, limit: pageLimit(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(loadedListing(pages), last.entries.length, last.total),
    select: mergeListing,
  });

export const entryQuery = (id: number) =>
  queryOptions({
    queryKey: ['entry', id],
    queryFn: () => getEntry(id),
  });

export const searchQuery = (q: string, opts: SearchOptions = {}) =>
  infiniteQueryOptions({
    queryKey: ['search', q, opts],
    queryFn: ({ pageParam }) => searchEntries(q, { ...opts, offset: pageParam, limit: pageLimit(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(loadedSearch(pages), last.results.length, last.total),
    select: mergeSearch,
  });

/**
 * Точечное обновление (К2): свежие записи подставляются во все загруженные
 * страницы листингов и поиска - без перечитывания папок целиком.
 */
export function patchCachedEntries(qc: QueryClient, fresh: readonly Entry[]): void {
  if (fresh.length === 0) return;
  const byId = new Map(fresh.map((e) => [e.id, e]));
  qc.setQueriesData<InfiniteData<Listing, number>>({ queryKey: ['listing'] }, (data) => {
    if (data === undefined) return data;
    let changed = false;
    const pages = data.pages.map((p) => {
      if (!p.entries.some((e) => byId.has(e.id))) return p;
      changed = true;
      return { ...p, entries: p.entries.map((e) => byId.get(e.id) ?? e) };
    });
    return changed ? { ...data, pages } : data;
  });
  qc.setQueriesData<InfiniteData<SearchResponse, number>>({ queryKey: ['search'] }, (data) => {
    if (data === undefined) return data;
    let changed = false;
    const pages = data.pages.map((p) => {
      if (!p.results.some((h) => byId.has(h.entry.id))) return p;
      changed = true;
      return { ...p, results: p.results.map((h) => ({ ...h, entry: byId.get(h.entry.id) ?? h.entry })) };
    });
    return changed ? { ...data, pages } : data;
  });
}

export const trashQuery = queryOptions({
  queryKey: ['trash', 'list'],
  queryFn: () => listTrash(),
});

/** Только счётчик для пункта «Корзина» в дереве. */
export const trashCountQuery = queryOptions({
  queryKey: ['trash', 'count'],
  queryFn: () => listTrash(1),
  select: (t) => t.total,
});

export const tagsQuery = queryOptions({
  queryKey: ['tags'],
  queryFn: getTags,
});

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: getSettings,
});

/** После импорта/переименования/перемещения/удаления: листинги, дерево, счётчик, поиск, счётчики тегов, корзина. */
export function invalidateContent(qc: QueryClient): void {
  for (const key of ['listing', 'folders', 'status', 'search', 'tags', 'entry', 'trash']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/** После смены тегов: карточки и результаты фильтра показывают теги, экран «Теги» — счётчики. */
export function invalidateTags(qc: QueryClient): void {
  for (const key of ['tags', 'listing', 'search', 'entry']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
