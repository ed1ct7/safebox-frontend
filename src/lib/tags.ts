import type { Category, Entry, PathItem, TagLanguage } from '../api/types';
import { foldForSearch } from './fold';

// Каталог тегов и чистая логика вокруг него (UF-16): группировка тегов записи по
// категориям, выбор чипов для карточки, счётчики по выделению. Без React.
//
// У тега и категории два имени: основное (name) и английское (nameEn, '' - не задано).
// Что показывать, решает язык тегов (настройка): в каталоге для каждого уже посчитан
// label, и всё, что выводит имя на экран, берёт его, а не name. Идентичность и
// фильтрация - по id; name/nameEn нужны только для поиска и правки.

/** Подпись по языку: английское имя, если выбран en и оно задано, иначе основное. */
export function labelOf(name: string, nameEn: string, lang: TagLanguage): string {
  return lang === 'en' && nameEn !== '' ? nameEn : name;
}

/** Тег каталога вместе с названиями своей категории. */
export interface CatalogTag {
  id: number;
  categoryId: number;
  name: string;
  nameEn: string; // '' - не задано
  /** подпись на языке тегов */
  label: string;
  category: string;
  categoryEn: string;
  categoryLabel: string;
  count: number; // записей с прямым присвоением
}

export interface CatalogCategory {
  id: number;
  name: string;
  nameEn: string; // '' - не задано
  /** подпись на языке тегов */
  label: string;
  tags: readonly CatalogTag[];
}

export interface TagCatalog {
  /** false - каталог ещё не загружен: имена тегов неизвестны, а не «тегов нет» */
  ready: boolean;
  /** язык, на котором посчитаны label */
  lang: TagLanguage;
  /** по подписи без учёта регистра; теги внутри - тоже */
  categories: readonly CatalogCategory[];
  tags: ReadonlyMap<number, CatalogTag>;
}

export const EMPTY_CATALOG: TagCatalog = { ready: false, lang: 'ru', categories: [], tags: new Map() };

function byFolded<T>(key: (item: T) => string) {
  return (a: T, b: T): number => {
    const x = foldForSearch(key(a));
    const y = foldForSearch(key(b));
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/** GET /tags -> каталог на языке lang; undefined (ещё не пришёл) - пустой и не готовый. */
export function buildCatalog(categories: readonly Category[] | undefined, lang: TagLanguage = 'ru'): TagCatalog {
  if (categories === undefined) return EMPTY_CATALOG;
  const sorted = categories
    .map((c): CatalogCategory => {
      const categoryLabel = labelOf(c.name, c.nameEn, lang);
      const tags = c.tags
        .map(
          (t): CatalogTag => ({
            id: t.id,
            categoryId: c.id,
            name: t.name,
            nameEn: t.nameEn,
            label: labelOf(t.name, t.nameEn, lang),
            category: c.name,
            categoryEn: c.nameEn,
            categoryLabel,
            count: t.count,
          }),
        )
        .sort(byFolded((t) => t.label));
      return { id: c.id, name: c.name, nameEn: c.nameEn, label: categoryLabel, tags };
    })
    .sort(byFolded((c) => c.label));
  const tags = new Map<number, CatalogTag>();
  for (const c of sorted) {
    for (const t of c.tags) tags.set(t.id, t);
  }
  return { ready: true, lang, categories: sorted, tags };
}

/** Совпало ли уже свёрнутое (foldForSearch) введённое с любым из двух имён. */
export function matchesName(name: string, nameEn: string, folded: string): boolean {
  return foldForSearch(name) === folded || (nameEn !== '' && foldForSearch(nameEn) === folded);
}

/** Категория по любому из двух имён: «character:…» и «персонаж:…» находят одну и ту же. */
export function findCategory(catalog: TagCatalog, name: string): CatalogCategory | undefined {
  const folded = foldForSearch(name.trim());
  return catalog.categories.find((c) => matchesName(c.name, c.nameEn, folded));
}

/** Тег категории по любому из двух имён: сервер считает дублем совпадение с любым. */
export function findTag(catalog: TagCatalog, categoryId: number, name: string): CatalogTag | undefined {
  const folded = foldForSearch(name.trim());
  for (const t of catalog.tags.values()) {
    if (t.categoryId === categoryId && matchesName(t.name, t.nameEn, folded)) return t;
  }
  return undefined;
}

/** Все теги каталога подряд: по категории, внутри - по подписи. */
export function allTags(catalog: TagCatalog): CatalogTag[] {
  return catalog.categories.flatMap((c) => c.tags);
}

/** Группа поиска по каталогу: категория и её совпавшие теги (в порядке каталога). */
export interface CatalogSearchGroup {
  category: CatalogCategory;
  tags: CatalogTag[];
}

/**
 * Поиск по каталогу для панелей: теги, у которых подстроку содержит показываемое
 * имя или любое из двух имён (без учёта регистра и «ё»); категории без
 * совпадений пропадают. Пустая строка - пустой результат.
 */
export function searchCatalogGroups(catalog: TagCatalog, query: string): CatalogSearchGroup[] {
  const q = foldForSearch(query.trim());
  if (q === '') return [];
  const hit = (t: CatalogTag): boolean =>
    foldForSearch(t.label).includes(q) ||
    foldForSearch(t.name).includes(q) ||
    (t.nameEn !== '' && foldForSearch(t.nameEn).includes(q));
  const out: CatalogSearchGroup[] = [];
  for (const c of catalog.categories) {
    const tags = c.tags.filter((t) => hit(t));
    if (tags.length > 0) out.push({ category: c, tags });
  }
  return out;
}

/**
 * Компактный вид категории: выбранные теги закреплены впереди, чтобы остаться
 * видимыми и за лимитом (даже с пустым счётчиком), дальше - по убыванию числа
 * записей, пустые - в конце по имени. hidden - сколько не влезло в лимит.
 */
export function previewTags(
  tags: readonly CatalogTag[],
  selected: ReadonlySet<number>,
  limit: number,
): { visible: CatalogTag[]; hidden: number } {
  const byLabel = byFolded((t: CatalogTag) => t.label);
  const ranked = [...tags].sort((a, b) => {
    const sa = selected.has(a.id) ? 1 : 0;
    const sb = selected.has(b.id) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if (sa === 1) return byLabel(a, b);
    if ((a.count > 0) !== (b.count > 0)) return a.count > 0 ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return byLabel(a, b);
  });
  const visible = limit > 0 ? ranked.slice(0, limit) : [];
  return { visible, hidden: ranked.length - visible.length };
}

/** «категория: тег» на языке тегов - так тег подписан в чипах, подсказках и крошке. */
export function tagText(tag: { categoryLabel: string; label: string }): string {
  return `${tag.categoryLabel}: ${tag.label}`;
}

/** Тег записи: прямой (inherit - действует на вложения) или унаследованный (fromId - от кого). */
export interface EntryTag {
  tagId: number;
  categoryId: number;
  categoryLabel: string;
  label: string;
  inherit: boolean;
  fromId: number | null;
}

export interface TagGroup {
  categoryId: number;
  categoryLabel: string;
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
      group = { categoryId: tag.categoryId, categoryLabel: tag.categoryLabel, direct: [], inherited: [] };
      groups.set(tag.categoryId, group);
    }
    const item: EntryTag = {
      tagId: tag.id,
      categoryId: tag.categoryId,
      categoryLabel: tag.categoryLabel,
      label: tag.label,
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
  const byLabel = byFolded((t: EntryTag) => t.label);
  const out = [...groups.values()].sort(byFolded((g) => g.categoryLabel));
  for (const g of out) {
    g.direct.sort(byLabel);
    g.inherited.sort(byLabel);
  }
  return out;
}

export const CARD_TAG_LIMIT = 3;

export interface CardChip {
  tagId: number;
  label: string;
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
  ].map((t) => ({ tagId: t.tagId, label: t.label, title: tagText(t), inherited: t.fromId !== null }));
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
