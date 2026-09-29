import type { SearchOptions } from '../api/endpoints';
import type { TagMatch } from '../api/types';
import { tagText } from './tags';
import type { TagCatalog } from './tags';

// Фильтр по тегам (UF-18): состояние и то, как оно превращается в запрос поиска.

export type FilterScope = 'vault' | 'folder';

export interface TagFilter {
  tags: readonly number[]; // выбранные теги в порядке выбора
  match: TagMatch; // 'categories': И между категориями, ИЛИ внутри
  scope: FilterScope; // весь сейф или открытая папка (с вложениями)
}

export const EMPTY_FILTER: TagFilter = { tags: [], match: 'categories', scope: 'vault' };

export const isFilterActive = (filter: TagFilter): boolean => filter.tags.length > 0;

/**
 * Параметры GET /search для фильтра; folderId - открытая папка или запись
 * (null - корень: «в этой папке» тогда то же, что весь сейф). Без тегов - пусто:
 * область и режим без тегов ничего не значат. Теги по возрастанию - ключ кэша не
 * зависит от порядка выбора.
 */
export function searchOptionsFor(filter: TagFilter, folderId: number | null): SearchOptions {
  if (!isFilterActive(filter)) return {};
  const opts: SearchOptions = {
    tags: [...filter.tags].sort((a, b) => a - b),
    match: filter.match,
  };
  if (filter.scope === 'folder' && folderId !== null) opts.within = folderId;
  return opts;
}

export function addFilterTag(filter: TagFilter, tagId: number): TagFilter {
  return filter.tags.includes(tagId) ? filter : { ...filter, tags: [...filter.tags, tagId] };
}

export function removeFilterTag(filter: TagFilter, tagId: number): TagFilter {
  return filter.tags.includes(tagId) ? { ...filter, tags: filter.tags.filter((id) => id !== tagId) } : filter;
}

/**
 * Убирает из фильтра теги, которых больше нет (удалили, слили): сервер на
 * неизвестный id отвечает 422. Пока каталог не загружен - ничего не трогаем.
 * Возвращает тот же объект, если менять нечего.
 */
export function pruneFilterTags(filter: TagFilter, catalog: TagCatalog): TagFilter {
  if (!catalog.ready) return filter;
  const alive = filter.tags.filter((id) => catalog.tags.has(id));
  return alive.length === filter.tags.length ? filter : { ...filter, tags: alive };
}

/** Текст крошки «Фильтр: …»: теги «категория: тег» через запятую; в папке - с пометкой. */
export function filterSummary(filter: TagFilter, catalog: TagCatalog, folderId: number | null): string {
  const names = filter.tags.flatMap((id) => {
    const tag = catalog.tags.get(id);
    return tag === undefined ? [] : [tagText(tag)];
  });
  const scope = filter.scope === 'folder' && folderId !== null ? ' · в этой папке' : '';
  return `${names.join(', ')}${scope}`;
}
