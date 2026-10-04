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
  labelOf,
  pathNames,
  previewTags,
  searchCatalogGroups,
  selectionTags,
  tagText,
} from './tags';

const categories: Category[] = [
  {
    id: 20,
    name: 'language',
    nameEn: '',
    tags: [
      { id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 4 },
      { id: 6, categoryId: 20, name: 'en', nameEn: '', count: 1 },
    ],
  },
  {
    id: 10,
    name: 'Character',
    nameEn: '',
    tags: [
      { id: 2, categoryId: 10, name: 'Roxy Migurdia', nameEn: '', count: 2 },
      { id: 1, categoryId: 10, name: 'eris greyrat', nameEn: '', count: 3 },
    ],
  },
  { id: 30, name: 'Ёж', nameEn: '', tags: [] },
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
      nameEn: '',
      label: 'Roxy Migurdia',
      category: 'Character',
      categoryEn: '',
      categoryLabel: 'Character',
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
    expect(tagText({ categoryLabel: 'language', label: 'ru' })).toBe('language: ru');
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
    expect(groups.map((g) => g.categoryLabel)).toEqual(['Character', 'language']);
    const [character, language] = groups;
    expect(character?.direct.map((t) => [t.label, t.inherit])).toEqual([
      ['eris greyrat', false],
      ['Roxy Migurdia', true],
    ]);
    expect(language?.direct.map((t) => t.label)).toEqual(['ru']);
    expect(language?.inherited).toEqual([
      { tagId: 6, categoryId: 20, categoryLabel: 'language', label: 'en', inherit: false, fromId: 77 },
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
    expect(chips.map((c) => c.label)).toEqual(['eris greyrat', 'Roxy Migurdia', 'en']);
    expect(more).toBe(1);
  });

  it('прямые раньше унаследованных, даже если те из «более ранней» категории', () => {
    const entry = makeEntry({ tags: tags(5), inheritedTags: [{ tagId: 1, fromId: 9 }] });
    const { chips, more } = cardTagChips(entry, catalog);
    expect(chips.map((c) => [c.label, c.inherited])).toEqual([
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

// Два имени (основное и английское) и язык тегов: показывается одно, id и фильтр не меняются.
describe('язык тегов', () => {
  // второго имени нет у тега «Рокси» и у категории «Язык» - там остаётся основное
  const bilingual: Category[] = [
    {
      id: 10,
      name: 'Персонаж',
      nameEn: 'Character',
      tags: [
        { id: 1, categoryId: 10, name: 'Хината', nameEn: 'hyuuga hinata', count: 3 },
        { id: 2, categoryId: 10, name: 'Рокси', nameEn: '', count: 2 },
        { id: 3, categoryId: 10, name: 'Ариэль', nameEn: 'Zed', count: 0 },
      ],
    },
    { id: 20, name: 'Язык', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 4 }] },
    { id: 30, name: 'Аниме', nameEn: 'Zeta', tags: [] },
  ];
  const ru = buildCatalog(bilingual, 'ru');
  const en = buildCatalog(bilingual, 'en');

  it('labelOf: английское имя при en, если оно задано, иначе основное', () => {
    expect(labelOf('Хината', 'hinata', 'ru')).toBe('Хината');
    expect(labelOf('Хината', 'hinata', 'en')).toBe('hinata');
    expect(labelOf('Рокси', '', 'en')).toBe('Рокси'); // второго имени нет - основное
    expect(labelOf('Рокси', '', 'ru')).toBe('Рокси');
  });

  it('по умолчанию каталог русский; язык запоминается в каталоге', () => {
    expect(buildCatalog(bilingual).tags.get(1)?.label).toBe('Хината');
    expect(buildCatalog(bilingual).lang).toBe('ru');
    expect(en.lang).toBe('en');
    expect(EMPTY_CATALOG.lang).toBe('ru');
  });

  it('у тега и категории подпись по языку, оба имени сохранены', () => {
    expect(ru.tags.get(1)).toMatchObject({ label: 'Хината', nameEn: 'hyuuga hinata', categoryLabel: 'Персонаж' });
    expect(en.tags.get(1)).toMatchObject({
      label: 'hyuuga hinata',
      name: 'Хината',
      nameEn: 'hyuuga hinata',
      categoryLabel: 'Character',
      category: 'Персонаж',
      categoryEn: 'Character',
    });
    expect(en.categories.find((c) => c.id === 10)).toMatchObject({ label: 'Character', name: 'Персонаж' });
  });

  it('нет английского имени - в en остаётся основное', () => {
    expect(en.tags.get(2)?.label).toBe('Рокси');
    expect(en.tags.get(5)).toMatchObject({ label: 'ru', categoryLabel: 'Язык' });
  });

  it('сортировка - по показываемой подписи', () => {
    expect(ru.categories.map((c) => c.label)).toEqual(['Аниме', 'Персонаж', 'Язык']);
    expect(ru.categories[1]?.tags.map((t) => t.label)).toEqual(['Ариэль', 'Рокси', 'Хината']);
    expect(en.categories.map((c) => c.label)).toEqual(['Character', 'Zeta', 'Язык']);
    expect(en.categories[0]?.tags.map((t) => t.label)).toEqual(['hyuuga hinata', 'Zed', 'Рокси']);
    expect(allTags(en).map((t) => t.id)).toEqual([1, 3, 2, 5]); // id не зависят от языка
  });

  it('категория и тег находятся по любому из двух имён, при любом языке', () => {
    for (const c of [ru, en]) {
      expect(findCategory(c, 'character')?.id).toBe(10);
      expect(findCategory(c, 'персонаж')?.id).toBe(10);
      expect(findTag(c, 10, 'HYUUGA hinata')?.id).toBe(1);
      expect(findTag(c, 10, 'хината')?.id).toBe(1);
      expect(findTag(c, 10, '')).toBeUndefined(); // пустое второе имя - не имя
    }
  });

  it('tagText, группы и чипы записи - на языке тегов', () => {
    const entry = makeEntry({ tags: [{ tagId: 1, inherit: false }, { tagId: 2, inherit: false }] });
    expect(tagText(ru.tags.get(1)!)).toBe('Персонаж: Хината');
    expect(tagText(en.tags.get(1)!)).toBe('Character: hyuuga hinata');
    const [group] = groupEntryTags(entry, en);
    expect(group?.categoryLabel).toBe('Character');
    expect(group?.direct.map((t) => t.label)).toEqual(['hyuuga hinata', 'Рокси']);
    const { chips } = cardTagChips(entry, en);
    expect(chips.map((c) => [c.tagId, c.label, c.title])).toEqual([
      [1, 'hyuuga hinata', 'Character: hyuuga hinata'],
      [2, 'Рокси', 'Character: Рокси'],
    ]);
  });

  it('список тегов выделенных: порядок по подписи на языке тегов', () => {
    const entries = [makeEntry({ tags: [{ tagId: 1, inherit: false }, { tagId: 3, inherit: false }] })];
    expect(selectionTags(entries, ru).map((r) => r.tag.id)).toEqual([3, 1]); // Ариэль, Хината
    expect(selectionTags(entries, en).map((r) => r.tag.id)).toEqual([1, 3]); // hyuuga hinata, Zed
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

describe('previewTags', () => {
  const uiCatalog = buildCatalog([
    {
      id: 10,
      name: 'character',
      nameEn: '',
      tags: [
        { id: 1, categoryId: 10, name: 'eris', nameEn: '', count: 5 },
        { id: 2, categoryId: 10, name: 'roxy', nameEn: '', count: 9 },
        { id: 3, categoryId: 10, name: 'hinata', nameEn: '', count: 0 },
        { id: 4, categoryId: 10, name: 'aqua', nameEn: '', count: 1 },
        { id: 5, categoryId: 10, name: 'Ёжик', nameEn: 'Hedgehog', count: 0 },
      ],
    },
    { id: 20, name: 'language', nameEn: '', tags: [{ id: 6, categoryId: 20, name: 'ru', nameEn: 'RU', count: 0 }] },
  ]);
  const character = () => uiCatalog.categories[0]!;

  it('популярные впереди, пустые в конце по имени', () => {
    const { visible, hidden } = previewTags(character().tags, new Set(), 3);
    expect(visible.map((t) => t.id)).toEqual([2, 1, 4]); // roxy 9, eris 5, aqua 1
    expect(hidden).toBe(2);
  });

  it('выбранные закреплены впереди, даже с пустым счётчиком', () => {
    const { visible, hidden } = previewTags(character().tags, new Set([3]), 2);
    expect(visible.map((t) => t.id)).toEqual([3, 2]);
    expect(hidden).toBe(3);
  });

  it('лимит не меньше длины - видны все, скрытых нет', () => {
    const { visible, hidden } = previewTags(character().tags, new Set(), 100);
    expect(visible).toHaveLength(5);
    expect(hidden).toBe(0);
  });
});

describe('searchCatalogGroups', () => {
  const uiCatalog = buildCatalog([
    {
      id: 10,
      name: 'character',
      nameEn: '',
      tags: [
        { id: 1, categoryId: 10, name: 'eris greyrat', nameEn: '', count: 3 },
        { id: 2, categoryId: 10, name: 'roxy migurdia', nameEn: '', count: 1 },
      ],
    },
    { id: 20, name: 'language', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: 'RU', count: 4 }] },
    { id: 30, name: 'Ёж', nameEn: '', tags: [{ id: 7, categoryId: 30, name: 'ёжик в тумане', nameEn: '', count: 0 }] },
  ]);

  it('подстрока без учёта регистра и «ё», по любому из двух имён', () => {
    const groups = searchCatalogGroups(uiCatalog, 'ЕЖИК');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category.id).toBe(30);
    expect(groups[0]?.tags.map((t) => t.id)).toEqual([7]);
    expect(searchCatalogGroups(uiCatalog, 'hedge')).toEqual([]); // nameEn не задан - не имя
    expect(searchCatalogGroups(uiCatalog, 'GREY').map((g) => g.tags.map((t) => t.id))).toEqual([[1]]);
  });

  it('категории без совпадений пропадают, пустой запрос - пустой результат', () => {
    expect(searchCatalogGroups(uiCatalog, 'ru').map((g) => g.category.id)).toEqual([20]);
    expect(searchCatalogGroups(uiCatalog, 'zzz')).toEqual([]);
    expect(searchCatalogGroups(uiCatalog, '  ')).toEqual([]);
  });
});
