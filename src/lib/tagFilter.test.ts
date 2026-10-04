import { describe, expect, it } from 'vitest';
import { searchPath } from '../api/endpoints';
import {
  addFilterTag,
  EMPTY_FILTER,
  filterSummary,
  isFilterActive,
  pruneFilterTags,
  removeFilterTag,
  searchOptionsFor,
} from './tagFilter';
import type { TagFilter } from './tagFilter';
import { buildCatalog, EMPTY_CATALOG } from './tags';

const catalog = buildCatalog([
  {
    id: 10,
    name: 'character',
    nameEn: '',
    tags: [
      { id: 1, categoryId: 10, name: 'eris', nameEn: '', count: 0 },
      { id: 2, categoryId: 10, name: 'roxy', nameEn: '', count: 0 },
    ],
  },
  { id: 20, name: 'language', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 0 }] },
]);

const filter = (extra: Partial<TagFilter> = {}): TagFilter => ({ ...EMPTY_FILTER, ...extra });

describe('searchOptionsFor', () => {
  it('без тегов - пустые параметры: режим и область ничего не значат', () => {
    expect(searchOptionsFor(EMPTY_FILTER, 5)).toEqual({});
    expect(searchOptionsFor(filter({ scope: 'folder', match: 'all' }), 5)).toEqual({});
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('по умолчанию: И между категориями, весь сейф', () => {
    expect(searchOptionsFor(filter({ tags: [5, 1] }), 7)).toEqual({ tags: [1, 5], match: 'categories' });
  });

  it('теги по возрастанию: ключ кэша не зависит от порядка выбора', () => {
    expect(searchOptionsFor(filter({ tags: [5, 1, 2] }), null).tags).toEqual([1, 2, 5]);
  });

  it('режим сочетания передаётся как есть', () => {
    expect(searchOptionsFor(filter({ tags: [1], match: 'all' }), null).match).toBe('all');
    expect(searchOptionsFor(filter({ tags: [1], match: 'any' }), null).match).toBe('any');
  });

  it('«в этой папке» - within открытой папки или записи; в корне - весь сейф', () => {
    expect(searchOptionsFor(filter({ tags: [1], scope: 'folder' }), 42).within).toBe(42);
    expect(searchOptionsFor(filter({ tags: [1], scope: 'folder' }), null)).not.toHaveProperty('within');
    expect(searchOptionsFor(filter({ tags: [1], scope: 'vault' }), 42)).not.toHaveProperty('within');
  });

  it('вместе с адресом: GET /search?q=&tags=…&match=…&within=…', () => {
    const opts = searchOptionsFor(filter({ tags: [5, 1], match: 'any', scope: 'folder' }), 9);
    expect(searchPath('кот', opts)).toBe(
      `/api/v1/search?q=${encodeURIComponent('кот')}&tags=1%2C5&match=any&within=9`,
    );
  });
});

describe('addFilterTag / removeFilterTag', () => {
  it('добавляет в конец, повтор и отсутствующий - тот же объект', () => {
    const f = addFilterTag(EMPTY_FILTER, 3);
    expect(f.tags).toEqual([3]);
    expect(addFilterTag(f, 3)).toBe(f);
    expect(addFilterTag(f, 4).tags).toEqual([3, 4]);
    expect(removeFilterTag(f, 99)).toBe(f);
    expect(removeFilterTag(addFilterTag(f, 4), 3).tags).toEqual([4]);
  });

  it('режим и область сохраняются', () => {
    const f = filter({ match: 'any', scope: 'folder' });
    expect(addFilterTag(f, 1)).toMatchObject({ match: 'any', scope: 'folder' });
  });
});

describe('pruneFilterTags', () => {
  it('убирает исчезнувшие теги (удалили, слили)', () => {
    expect(pruneFilterTags(filter({ tags: [1, 999, 5] }), catalog).tags).toEqual([1, 5]);
  });

  it('всё цело - тот же объект', () => {
    const f = filter({ tags: [1, 5] });
    expect(pruneFilterTags(f, catalog)).toBe(f);
  });

  it('каталог не загружен - фильтр не трогаем', () => {
    const f = filter({ tags: [1] });
    expect(pruneFilterTags(f, EMPTY_CATALOG)).toBe(f);
  });
});

describe('filterSummary', () => {
  it('теги «категория: тег» через запятую в порядке выбора', () => {
    expect(filterSummary(filter({ tags: [5, 1] }), catalog, null)).toBe('language: ru, character: eris');
  });

  it('в папке - с пометкой, в корне - без', () => {
    const f = filter({ tags: [1], scope: 'folder' });
    expect(filterSummary(f, catalog, 3)).toBe('character: eris · в этой папке');
    expect(filterSummary(f, catalog, null)).toBe('character: eris');
  });

  it('неизвестные теги пропускаются', () => {
    expect(filterSummary(filter({ tags: [404, 2] }), catalog, null)).toBe('character: roxy');
  });
});
