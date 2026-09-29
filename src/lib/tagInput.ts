import { foldForSearch } from './fold';
import { validateTagName } from './rules';
import { allTags, findCategory, findTag } from './tags';
import type { CatalogTag, TagCatalog } from './tags';

// Разбор ввода «категория:тег» и подсказки для поля с автодополнением (UF-16, UF-18).

export interface ParsedTagInput {
  /** null - двоеточия нет, введён просто текст */
  category: string | null;
  name: string;
}

/** Первое «:» делит категорию и тег (в самих именах «:» запрещено); края обрезаются. */
export function parseTagInput(text: string): ParsedTagInput {
  const i = text.indexOf(':');
  if (i === -1) return { category: null, name: text.trim() };
  return { category: text.slice(0, i).trim(), name: text.slice(i + 1).trim() };
}

/** Что подставляет Tab в поле. */
export function completionText(tag: Pick<CatalogTag, 'category' | 'name'>): string {
  return `${tag.category}:${tag.name}`;
}

/** Создать тег name в категории category (newCategory - категории ещё нет и нужно подтверждение). */
export interface CreatePlan {
  category: string;
  name: string;
  newCategory: boolean;
}

export interface Suggestions {
  tags: CatalogTag[];
  create: CreatePlan | null;
  /** введён существующий тег целиком (и его можно выбрать) */
  exact: CatalogTag | null;
  hint: string | null;
  /** введённое нельзя превратить в тег: сообщение о причине */
  error: string | null;
}

export interface SuggestOptions {
  /** предлагать создание тега и категории (в фильтре - нет) */
  allowCreate: boolean;
  /** уже выбранные теги: их не предлагаем */
  exclude?: ReadonlySet<number>;
  limit?: number;
}

export const NEED_CATEGORY_HINT = 'Укажите категорию: категория:тег';
const ALREADY_HINT = 'Этот тег уже добавлен';
const NO_TAG_HINT = 'Такого тега нет';
const DEFAULT_LIMIT = 50;

/**
 * Подсказки по тексту. Без «:» ищем по имени тега и по названию категории, с «:» -
 * категория слева, тег справа (обе части - подстрока, без учёта регистра, «ё» = «е»).
 * Точные совпадения и начала имён - выше. Создание предлагается только с «:» и
 * только если такого тега ещё нет: без категории тегов не бывает.
 */
export function suggestTags(catalog: TagCatalog, text: string, opts: SuggestOptions): Suggestions {
  const { allowCreate, exclude, limit = DEFAULT_LIMIT } = opts;
  const parsed = parseTagInput(text);
  const result: Suggestions = { tags: [], create: null, exact: null, hint: null, error: null };
  const nameQ = foldForSearch(parsed.name);
  const catQ = parsed.category === null ? null : foldForSearch(parsed.category);

  // существующий тег, введённый целиком
  let exact: CatalogTag | undefined;
  if (parsed.category !== null) {
    const category = findCategory(catalog, parsed.category);
    if (category !== undefined && nameQ !== '') exact = findTag(catalog, category.id, parsed.name);
  } else if (nameQ !== '') {
    const same = allTags(catalog).filter((t) => foldForSearch(t.name) === nameQ);
    if (same.length === 1) exact = same[0];
  }
  const excluded = exact !== undefined && exclude?.has(exact.id) === true;
  if (exact !== undefined && !excluded) result.exact = exact;

  const scored: { tag: CatalogTag; score: number; cat: string; name: string }[] = [];
  let alreadyChosen = 0; // подошло бы, но уже выбрано
  for (const tag of allTags(catalog)) {
    const cat = foldForSearch(tag.category);
    const name = foldForSearch(tag.name);
    let score: number;
    if (catQ !== null) {
      if (!cat.includes(catQ) || !name.includes(nameQ)) continue;
      score = (cat === catQ ? 0 : cat.startsWith(catQ) ? 1 : 2) * 4 + rankName(name, nameQ);
    } else {
      const inName = name.includes(nameQ);
      if (!inName && !cat.includes(nameQ)) continue;
      score = inName ? rankName(name, nameQ) : cat.startsWith(nameQ) ? 2 : 3;
    }
    if (exclude?.has(tag.id) === true) alreadyChosen += 1;
    else scored.push({ tag, score, cat, name });
  }
  scored.sort((a, b) => a.score - b.score || compare(a.cat, b.cat) || compare(a.name, b.name));
  result.tags = scored.slice(0, limit).map((s) => s.tag);

  if (allowCreate && parsed.category !== null && nameQ !== '' && exact === undefined) {
    const problem =
      parsed.category === ''
        ? NEED_CATEGORY_HINT
        : (validateTagName(parsed.category, 'категории') ?? validateTagName(parsed.name));
    if (problem !== null) {
      result.error = problem;
    } else {
      const category = findCategory(catalog, parsed.category);
      result.create = {
        category: category?.name ?? parsed.category,
        name: parsed.name,
        newCategory: category === undefined,
      };
    }
  }

  if (result.tags.length === 0 && alreadyChosen > 0) {
    result.hint = ALREADY_HINT;
  } else if (result.tags.length === 0 && result.create === null && result.error === null) {
    if (text.trim() === '') result.hint = allowCreate ? 'Тегов пока нет. Введите категория:тег' : 'Тегов пока нет';
    else if (!allowCreate) result.hint = NO_TAG_HINT;
    else if (catQ === null) result.hint = NEED_CATEGORY_HINT;
  }
  return result;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rankName(name: string, query: string): number {
  return name === query ? 0 : name.startsWith(query) ? 1 : 2;
}
