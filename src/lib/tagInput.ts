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

/** Создать тег name; category=null - категорию ещё не выбрали (как в менеджерах тегов:
 * вводится только имя, категорию кликают в панели создания, а не печатают). */
export type CreatePlan =
  | { category: null; name: string; newCategory: false }
  | ResolvedCreatePlan;

/** План после выбора категории - то, что поле отправляет в onCreate. */
export interface ResolvedCreatePlan {
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
 * Точные совпадения и начала имён - выше. Создание - как в менеджерах тегов: для
 * голого имени «Создать тег «имя»» с выбором категории кликом (category=null);
 * «категория:тег» тоже создаёт, категория тогда берётся из ввода.
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

  // создание (как в менеджерах тегов: имя вводят, категорию потом выбирают кликом).
  // «категория:тег» по-прежнему работает - но как ярлык, а не обязательный путь
  if (allowCreate && nameQ !== '' && exact === undefined) {
    const problem = validateTagName(parsed.name);
    if (problem !== null) {
      result.error = problem; // и для голого имени: Enter молча ничего не сделает - скажем почему
    } else if (parsed.category === null) {
      result.create = { category: null, name: parsed.name, newCategory: false };
    } else if (parsed.category === '') {
      result.error = NEED_CATEGORY_HINT;
    } else {
      const categoryProblem = validateTagName(parsed.category, 'категории');
      if (categoryProblem !== null) result.error = categoryProblem;
      else {
        const category = findCategory(catalog, parsed.category);
        result.create = {
          category: category?.name ?? parsed.category,
          name: parsed.name,
          newCategory: category === undefined,
        };
      }
    }
  }

  if (result.tags.length === 0 && alreadyChosen > 0) {
    result.hint = ALREADY_HINT;
  } else if (result.tags.length === 0 && result.create === null && result.error === null) {
    if (text.trim() === '') result.hint = allowCreate ? 'Тегов пока нет. Введите имя тега' : 'Тегов пока нет';
    else if (!allowCreate) result.hint = NO_TAG_HINT;
  }
  return result;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rankName(name: string, query: string): number {
  return name === query ? 0 : name.startsWith(query) ? 1 : 2;
}
