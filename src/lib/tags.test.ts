import { describe, expect, it } from 'vitest';
import type { Category } from '../api/types';
import { makeEntry } from '../test/factories';
import {
  allTags,
  buildCatalog,
  cardTagChips,
  EMPTY_CATALOG,
  findCategory,
  findTag,
  groupEntryTags,
  pathNames,
  selectionTags,
  tagText,
} from './tags';

const categories: Category[] = [
  {
    id: 20,
    name: 'language',
    tags: [
      { id: 5, categoryId: 20, name: 'ru', count: 4 },
      { id: 6, categoryId: 20, name: 'en', count: 1 },
    ],
  },
  {
    id: 10,
    name: 'Character',
    tags: [
      { id: 2, categoryId: 10, name: 'Roxy Migurdia', count: 2 },
      { id: 1, categoryId: 10, name: 'eris greyrat', count: 3 },
    ],
  },
  { id: 30, name: 'Ёж', tags: [] },
];

const catalog = buildCatalog(categories);

describe('buildCatalog', () => {
  it('не загруженный каталог пуст и не готов', () => {
    expect(buildCatalog(undefined)).toBe(EMPTY_CATALOG);
    expect(EMPTY_CATALOG.ready).toBe(false);
    expect(catalog.ready).toBe(true);
  });

  it('категории и теги сортируются без учёта регистра, «ё» считается как «е»', () => {
    expect(catalog.categories.map((c) => c.name)).toEqual(['Character', 'language', 'Ёж']);
    expect(catalog.categories[0]?.tags.map((t) => t.name)).toEqual(['eris greyrat', 'Roxy Migurdia']);
  });

  it('тег знает свою категорию', () => {
    expect(catalog.tags.get(2)).toEqual({
      id: 2,
      categoryId: 10,
      name: 'Roxy Migurdia',
      category: 'Character',
      count: 2,
    });
    expect(catalog.tags.get(999)).toBeUndefined();
  });

  it('исходные данные не меняются', () => {
    expect(categories.map((c) => c.id)).toEqual([20, 10, 30]);
  });
});

describe('поиск в каталоге', () => {
  it('категория и тег находятся без учёта регистра и «ё»', () => {
    expect(findCategory(catalog, ' character ')?.id).toBe(10);
    expect(findCategory(catalog, 'еж')?.id).toBe(30);
    expect(findCategory(catalog, 'нет')).toBeUndefined();
    expect(findTag(catalog, 10, 'ERIS GREYRAT')?.id).toBe(1);
    expect(findTag(catalog, 20, 'eris greyrat')).toBeUndefined(); // в другой категории
  });

  it('allTags - подряд по категориям', () => {
    expect(allTags(catalog).map((t) => t.id)).toEqual([1, 2, 6, 5]);
  });

  it('tagText - «категория: тег»', () => {
    expect(tagText({ category: 'language', name: 'ru' })).toBe('language: ru');
  });
});

describe('groupEntryTags', () => {
  it('группы по категориям, прямые и унаследованные раздельно', () => {
    const entry = makeEntry({
      tags: [
        { tagId: 5, inherit: false },
        { tagId: 2, inherit: true },
        { tagId: 1, inherit: false },
      ],
      inheritedTags: [{ tagId: 6, fromId: 77 }],
    });
    const groups = groupEntryTags(entry, catalog);
    expect(groups.map((g) => g.category)).toEqual(['Character', 'language']);
    const [character, language] = groups;
    expect(character?.direct.map((t) => [t.name, t.inherit])).toEqual([
      ['eris greyrat', false],
      ['Roxy Migurdia', true],
    ]);
    expect(language?.direct.map((t) => t.name)).toEqual(['ru']);
    expect(language?.inherited).toEqual([
      { tagId: 6, categoryId: 20, category: 'language', name: 'en', inherit: false, fromId: 77 },
    ]);
  });

  it('категория с одними унаследованными тегами тоже есть', () => {
    const groups = groupEntryTags(makeEntry({ inheritedTags: [{ tagId: 1, fromId: 9 }] }), catalog);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.direct).toEqual([]);
    expect(groups[0]?.inherited[0]?.fromId).toBe(9);
  });

  it('неизвестные каталогу теги пропускаются', () => {
    const entry = makeEntry({ tags: [{ tagId: 999, inherit: false }] });
    expect(groupEntryTags(entry, catalog)).toEqual([]);
    expect(groupEntryTags(makeEntry({ tags: [{ tagId: 1, inherit: false }] }), EMPTY_CATALOG)).toEqual([]);
  });

  it('нет тегов - нет групп', () => {
    expect(groupEntryTags(makeEntry(), catalog)).toEqual([]);
  });
});

describe('cardTagChips', () => {
  const tags = (...ids: number[]) => ids.map((tagId) => ({ tagId, inherit: false }));

  it('до трёх тегов и «+N» за краем', () => {
    const entry = makeEntry({ tags: tags(5, 6, 1, 2) });
    const { chips, more } = cardTagChips(entry, catalog);
    expect(chips.map((c) => c.name)).toEqual(['eris greyrat', 'Roxy Migurdia', 'en']);
    expect(more).toBe(1);
  });

  it('прямые раньше унаследованных, даже если те из «более ранней» категории', () => {
    const entry = makeEntry({ tags: tags(5), inheritedTags: [{ tagId: 1, fromId: 9 }] });
    const { chips, more } = cardTagChips(entry, catalog);
    expect(chips.map((c) => [c.name, c.inherited])).toEqual([
      ['ru', false],
      ['eris greyrat', true],
    ]);
    expect(more).toBe(0);
  });

  it('в подсказке чипа - «категория: тег»', () => {
    const { chips } = cardTagChips(makeEntry({ tags: tags(1) }), catalog);
    expect(chips[0]?.title).toBe('Character: eris greyrat');
  });

  it('предел настраивается, тегов нет - пусто', () => {
    expect(cardTagChips(makeEntry({ tags: tags(1, 2, 5) }), catalog, 1)).toMatchObject({ more: 2 });
    expect(cardTagChips(makeEntry(), catalog)).toEqual({ chips: [], more: 0 });
  });
});

describe('selectionTags', () => {
  it('считает записи с прямым тегом, чаще встречающиеся выше', () => {
    const entries = [
      makeEntry({ id: 1, tags: [{ tagId: 5, inherit: false }, { tagId: 1, inherit: true }] }),
      makeEntry({ id: 2, tags: [{ tagId: 5, inherit: false }] }),
      makeEntry({ id: 3, tags: [{ tagId: 2, inherit: false }] }),
    ];
    const rows = selectionTags(entries, catalog);
    expect(rows.map((r) => [r.tag.id, r.count])).toEqual([
      [5, 2],
      [1, 1],
      [2, 1],
    ]);
  });

  it('унаследованные не учитываются, неизвестные пропускаются', () => {
    const entries = [makeEntry({ tags: [{ tagId: 404, inherit: false }], inheritedTags: [{ tagId: 1, fromId: 8 }] })];
    expect(selectionTags(entries, catalog)).toEqual([]);
  });
});

describe('pathNames', () => {
  it('собирает имена из нескольких цепочек, последняя запись побеждает', () => {
    const names = pathNames([
      [{ id: 1, name: 'Отпуск' }],
      [
        { id: 1, name: 'Отпуск' },
        { id: 2, name: 'Море' },
      ],
    ]);
    expect([...names]).toEqual([
      [1, 'Отпуск'],
      [2, 'Море'],
    ]);
  });
});
