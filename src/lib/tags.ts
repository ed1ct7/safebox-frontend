import type { Category, Entry, PathItem } from '../api/types';
import { foldForSearch } from './fold';

// Каталог тегов и чистая логика вокруг него (UF-16): группировка тегов записи по
// категориям, выбор чипов для карточки, счётчики по выделению. Без React.

/** Тег каталога вместе с названием своей категории. */
export interface CatalogTag {
  id: number;
  categoryId: number;
  name: string;
  category: string;
  count: number; // записей с прямым присвоением
}

export interface TagCatalog {
  /** false - каталог ещё не загружен: имена тегов неизвестны, а не «тегов нет» */
  ready: boolean;
  /** по имени без учёта регистра; теги внутри - тоже */
  categories: readonly Category[];
  tags: ReadonlyMap<number, CatalogTag>;
}

export const EMPTY_CATALOG: TagCatalog = { ready: false, categories: [], tags: new Map() };

function byFolded<T>(key: (item: T) => string) {
  return (a: T, b: T): number => {
    const x = foldForSearch(key(a));
    const y = foldForSearch(key(b));
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/** GET /tags -> каталог; undefined (ещё не пришёл) - пустой и не готовый. */
export function buildCatalog(categories: readonly Category[] | undefined): TagCatalog {
  if (categories === undefined) return EMPTY_CATALOG;
  const sorted = [...categories]
    .sort(byFolded((c) => c.name))
    .map((c) => ({ ...c, tags: [...c.tags].sort(byFolded((t) => t.name)) }));
  const tags = new Map<number, CatalogTag>();
  for (const c of sorted) {
    for (const t of c.tags) {
      tags.set(t.id, { id: t.id, categoryId: c.id, name: t.name, category: c.name, count: t.count });
    }
  }
  return { ready: true, categories: sorted, tags };
}

export function findCategory(catalog: TagCatalog, name: string): Category | undefined {
  const folded = foldForSearch(name.trim());
  return catalog.categories.find((c) => foldForSearch(c.name) === folded);
}

export function findTag(catalog: TagCatalog, categoryId: number, name: string): CatalogTag | undefined {
  const folded = foldForSearch(name.trim());
  for (const t of catalog.tags.values()) {
    if (t.categoryId === categoryId && foldForSearch(t.name) === folded) return t;
  }
  return undefined;
}

/** Все теги каталога подряд: по категории, внутри - по имени. */
export function allTags(catalog: TagCatalog): CatalogTag[] {
  return catalog.categories.flatMap((c) => c.tags.map((t) => catalog.tags.get(t.id))).filter((t) => t !== undefined);
}

/** «категория: тег» - так тег подписан в чипах, подсказках и крошке. */
export function tagText(tag: { category: string; name: string }): string {
  return `${tag.category}: ${tag.name}`;
}

/** Тег записи: прямой (inherit - действует на вложения) или унаследованный (fromId - от кого). */
export interface EntryTag {
  tagId: number;
  categoryId: number;
  category: string;
  name: string;
  inherit: boolean;
  fromId: number | null;
}

export interface TagGroup {
  categoryId: number;
  category: string;
  direct: EntryTag[];
  inherited: EntryTag[];
}

/**
 * Теги записи по категориям: сначала прямые, потом унаследованные. Неизвестные
 * каталогу теги (каталог ещё грузится или тег только что удалили) пропускаются.
 */
export function groupEntryTags(
  entry: Pick<Entry, 'tags' | 'inheritedTags'>,
  catalog: TagCatalog,
): TagGroup[] {
  const groups = new Map<number, TagGroup>();
  const put = (tag: CatalogTag, inherit: boolean, fromId: number | null) => {
    let group = groups.get(tag.categoryId);
    if (group === undefined) {
      group = { categoryId: tag.categoryId, category: tag.category, direct: [], inherited: [] };
      groups.set(tag.categoryId, group);
    }
    const item: EntryTag = {
      tagId: tag.id,
      categoryId: tag.categoryId,
      category: tag.category,
      name: tag.name,
      inherit,
      fromId,
    };
    (fromId === null ? group.direct : group.inherited).push(item);
  };
  for (const ref of entry.tags) {
    const tag = catalog.tags.get(ref.tagId);
    if (tag !== undefined) put(tag, ref.inherit, null);
  }
  for (const ref of entry.inheritedTags) {
    const tag = catalog.tags.get(ref.tagId);
    if (tag !== undefined) put(tag, false, ref.fromId);
  }
  const byName = byFolded((t: EntryTag) => t.name);
  const out = [...groups.values()].sort(byFolded((g) => g.category));
  for (const g of out) {
    g.direct.sort(byName);
    g.inherited.sort(byName);
  }
  return out;
}

export const CARD_TAG_LIMIT = 3;

export interface CardChip {
  tagId: number;
  name: string;
  /** «категория: тег» для подсказки: на карточке тесно, категорию не пишем */
  title: string;
  inherited: boolean;
}

/**
 * Чипы для карточки: первые limit тегов (прямые по категории и имени, потом
 * унаследованные) и сколько осталось за краем («+N»).
 */
export function cardTagChips(
  entry: Pick<Entry, 'tags' | 'inheritedTags'>,
  catalog: TagCatalog,
  limit: number = CARD_TAG_LIMIT,
): { chips: CardChip[]; more: number } {
  const groups = groupEntryTags(entry, catalog);
  const all: CardChip[] = [
    ...groups.flatMap((g) => g.direct),
    ...groups.flatMap((g) => g.inherited),
  ].map((t) => ({ tagId: t.tagId, name: t.name, title: tagText(t), inherited: t.fromId !== null }));
  return { chips: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export interface SelectionTag {
  tag: CatalogTag;
  count: number; // у скольких выделенных записей тег висит напрямую
}

/**
 * Прямые теги выделенных записей с числом записей: их можно снять массово.
 * Унаследованные не считаются - они снимаются только там, где их повесили.
 */
export function selectionTags(entries: readonly Pick<Entry, 'tags'>[], catalog: TagCatalog): SelectionTag[] {
  const counts = new Map<number, number>();
  for (const e of entries) {
    for (const ref of e.tags) counts.set(ref.tagId, (counts.get(ref.tagId) ?? 0) + 1);
  }
  const out: SelectionTag[] = [];
  for (const [id, count] of counts) {
    const tag = catalog.tags.get(id);
    if (tag !== undefined) out.push({ tag, count });
  }
  return out.sort(
    (a, b) => b.count - a.count || byFolded((t: CatalogTag) => tagText(t))(a.tag, b.tag),
  );
}

/** id -> имя по нескольким цепочкам крошек: имена записей-источников унаследованных тегов. */
export function pathNames(paths: Iterable<readonly PathItem[]>): Map<number, string> {
  const names = new Map<number, string>();
  for (const path of paths) {
    for (const item of path) names.set(item.id, item.name);
  }
  return names;
}
