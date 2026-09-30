import { describe, expect, it } from 'vitest';
import type { Category } from '../api/types';
import { completionText, NEED_CATEGORY_HINT, parseTagInput, suggestTags } from './tagInput';
import type { SuggestOptions } from './tagInput';
import { buildCatalog } from './tags';

const catalog = buildCatalog([
  {
    id: 10,
    name: 'character',
    tags: [
      { id: 1, categoryId: 10, name: 'eris greyrat', count: 3 },
      { id: 2, categoryId: 10, name: 'roxy migurdia', count: 2 },
      { id: 3, categoryId: 10, name: 'ёжик', count: 0 },
    ],
  },
  {
    id: 20,
    name: 'language',
    tags: [
      { id: 5, categoryId: 20, name: 'ru', count: 4 },
      { id: 6, categoryId: 20, name: 'eris', count: 0 },
    ],
  },
] satisfies Category[]);

const create: SuggestOptions = { allowCreate: true };
const filter: SuggestOptions = { allowCreate: false };
const ids = (text: string, opts: SuggestOptions = create) => suggestTags(catalog, text, opts).tags.map((t) => t.id);

describe('parseTagInput', () => {
  it('«категория:тег» делится по первому двоеточию, края обрезаются', () => {
    expect(parseTagInput('character:eris greyrat')).toEqual({ category: 'character', name: 'eris greyrat' });
    expect(parseTagInput('  character : eris  ')).toEqual({ category: 'character', name: 'eris' });
    expect(parseTagInput('a:b:c')).toEqual({ category: 'a', name: 'b:c' });
  });

  it('без двоеточия - просто текст', () => {
    expect(parseTagInput(' eris ')).toEqual({ category: null, name: 'eris' });
    expect(parseTagInput('')).toEqual({ category: null, name: '' });
  });

  it('двоеточие без частей', () => {
    expect(parseTagInput('кат:')).toEqual({ category: 'кат', name: '' });
    expect(parseTagInput(':тег')).toEqual({ category: '', name: 'тег' });
  });
});

describe('suggestTags: текст без «:»', () => {
  it('ищет по имени тега и по названию категории, без учёта регистра', () => {
    expect(ids('ROXY')).toEqual([2]);
    expect(ids('lang')).toEqual([6, 5]); // категория language: eris, ru
  });

  it('«ё» и «е» равны', () => {
    expect(ids('ежик')).toEqual([3]);
    expect(ids('ЁЖ')).toEqual([3]);
  });

  it('начало имени выше подстроки, точное совпадение - выше всего', () => {
    // «eris»: точный language:eris, потом начало character:eris greyrat
    expect(ids('eris')).toEqual([6, 1]);
    expect(ids('greyrat')).toEqual([1]);
  });

  it('пустой ввод - все теги подряд', () => {
    expect(ids('')).toEqual([1, 2, 3, 6, 5]);
  });

  it('предел числа подсказок', () => {
    expect(suggestTags(catalog, '', { ...create, limit: 2 }).tags).toHaveLength(2);
  });

  it('исключённые теги не предлагаются', () => {
    expect(ids('eris', { allowCreate: true, exclude: new Set([6]) })).toEqual([1]);
  });

  it('совпадений нет - «Создать тег …»: категорию выберут в панели (category=null)', () => {
    const r = suggestTags(catalog, 'zzz', create);
    expect(r.tags).toEqual([]);
    expect(r.create).toEqual({ category: null, name: 'zzz', newCategory: false });
    expect(r.hint).toBeNull();
    expect(r.error).toBeNull();
  });

  it('голое имя с плохим символом или длиной - ошибка, без варианта создания', () => {
    expect(suggestTags(catalog, `${'я'.repeat(101)}`, create).error).toMatch(/длиннее 100/);
    expect(suggestTags(catalog, 'a\u0001b', create).error).toMatch(/Управляющие/);
  });

  it('в фильтре вместо подсказки про категорию - «такого тега нет»', () => {
    expect(suggestTags(catalog, 'zzz', filter).hint).toBe('Такого тега нет');
  });

  it('единственный тег с таким именем - «точный»: Enter выберет его', () => {
    expect(suggestTags(catalog, 'ru', create).exact?.id).toBe(5);
    expect(suggestTags(catalog, 'ROXY MIGURDIA', create).exact?.id).toBe(2);
  });

  it('одноимённые теги в разных категориях - не «точный»: выбирает пользователь', () => {
    const twin = buildCatalog([
      { id: 1, name: 'a', tags: [{ id: 1, categoryId: 1, name: 'x', count: 0 }] },
      { id: 2, name: 'b', tags: [{ id: 2, categoryId: 2, name: 'x', count: 0 }] },
    ]);
    const r = suggestTags(twin, 'x', create);
    expect(r.exact).toBeNull();
    expect(r.tags.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe('suggestTags: «категория:тег»', () => {
  it('категория - подстрока названия, тег - подстрока имени', () => {
    expect(ids('char:eris')).toEqual([1]);
    expect(ids('LANG:e')).toEqual([6]);
    expect(ids('character:')).toEqual([1, 2, 3]);
  });

  it('точная категория выше частичной', () => {
    const c = buildCatalog([
      { id: 1, name: 'characters', tags: [{ id: 1, categoryId: 1, name: 'x', count: 0 }] },
      { id: 2, name: 'character', tags: [{ id: 2, categoryId: 2, name: 'x', count: 0 }] },
    ]);
    expect(suggestTags(c, 'character:x', create).tags.map((t) => t.id)).toEqual([2, 1]);
  });

  it('тег есть в существующей категории - он «точный», создавать нечего', () => {
    const r = suggestTags(catalog, 'Character:Eris Greyrat', create);
    expect(r.exact?.id).toBe(1);
    expect(r.create).toBeNull();
    expect(r.error).toBeNull();
  });

  it('нет тега в существующей категории - «Создать тег Y в категории X»', () => {
    const r = suggestTags(catalog, 'CHARACTER: Sylphy', create);
    expect(r.create).toEqual({ category: 'character', name: 'Sylphy', newCategory: false });
    expect(r.exact).toBeNull();
  });

  it('нет и категории - «Создать категорию X и тег Y»', () => {
    const r = suggestTags(catalog, 'место:Рим', create);
    expect(r.create).toEqual({ category: 'место', name: 'Рим', newCategory: true });
  });

  it('категория по «ё»/регистру находит существующую: имя берётся из каталога', () => {
    const c = buildCatalog([{ id: 1, name: 'Ёлки', tags: [] }]);
    expect(suggestTags(c, 'елки:x', create).create).toEqual({ category: 'Ёлки', name: 'x', newCategory: false });
  });

  it('в фильтре создание не предлагается', () => {
    const r = suggestTags(catalog, 'место:Рим', filter);
    expect(r.create).toBeNull();
    expect(r.hint).toBe('Такого тега нет');
  });

  it('пока тег не набран - создавать нечего', () => {
    expect(suggestTags(catalog, 'место:', create).create).toBeNull();
    expect(suggestTags(catalog, 'место:  ', create).error).toBeNull();
  });
});

describe('suggestTags: ошибки ввода', () => {
  it('пустая категория', () => {
    const r = suggestTags(catalog, ':тег', create);
    expect(r.error).toBe(NEED_CATEGORY_HINT);
    expect(r.create).toBeNull();
  });

  it('«:» в имени тега', () => {
    const r = suggestTags(catalog, 'character:a:b', create);
    expect(r.error).toBe('Символ «:» в имени тега запрещён');
    expect(r.create).toBeNull();
  });

  it('слишком длинное имя и управляющие символы', () => {
    expect(suggestTags(catalog, `character:${'я'.repeat(101)}`, create).error).toMatch(/длиннее 100/);
    expect(suggestTags(catalog, 'character:a\u0001b', create).error).toMatch(/Управляющие/);
    expect(suggestTags(catalog, `${'я'.repeat(101)}:тег`, create).error).toMatch(/категории/);
  });
});

describe('suggestTags: уже выбранный тег', () => {
  it('введён целиком - не «точный» и не создаётся, подсказка «уже добавлен»', () => {
    const r = suggestTags(catalog, 'character:eris greyrat', { allowCreate: true, exclude: new Set([1]) });
    expect(r.exact).toBeNull();
    expect(r.create).toBeNull();
    expect(r.tags).toEqual([]);
    expect(r.hint).toBe('Этот тег уже добавлен');
  });
});

describe('suggestTags: часть совпадений уже выбрана', () => {
  it('подходят только выбранные - «уже добавлен», а не «укажите категорию»', () => {
    const r = suggestTags(catalog, 'eris gr', { allowCreate: true, exclude: new Set([1]) });
    expect(r.tags).toEqual([]);
    expect(r.hint).toBe('Этот тег уже добавлен');
  });

  it('есть и другие подходящие - показываем их, подсказки нет', () => {
    const r = suggestTags(catalog, 'eris', { allowCreate: true, exclude: new Set([1]) });
    expect(r.tags.map((t) => t.id)).toEqual([6]);
    expect(r.hint).toBeNull();
  });
});

describe('completionText', () => {
  it('«категория:тег» без пробела - как вводят руками', () => {
    expect(completionText({ category: 'character', name: 'eris greyrat' })).toBe('character:eris greyrat');
  });
});
