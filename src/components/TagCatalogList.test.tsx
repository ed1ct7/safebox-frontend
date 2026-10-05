import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category } from '../api/types';
import { installFakeServer } from '../test/fakeServer';
import { makeWrapper } from '../test/tags';
import { TagCatalogList } from './TagCatalogList';

// Каталог тегов для панелей (UF-18): сворки категорий, компактный вид «популярные
// + Ещё N», поиск по имени; выбранные подсвечиваются, не меняя порядка;
// состояние сворок - в localStorage.

let categories: Category[];

function install(): void {
  installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories } }) });
}

function mount(selected: ReadonlySet<number> = new Set(), limit = 10) {
  const onToggle = vi.fn();
  const { unmount } = render(
    <TagCatalogList selected={selected} onToggle={onToggle} storageKey="test-catalog" limit={limit} />,
    { wrapper: makeWrapper().Wrapper },
  );
  return { onToggle, unmount, user: userEvent.setup() };
}

beforeEach(() => {
  localStorage.clear();
  install();
});
afterEach(() => vi.unstubAllGlobals());

const manyTags = Array.from({ length: 13 }, (_, i) => ({
  id: i + 1,
  categoryId: 10,
  name: `tag ${String(i + 1).padStart(2, '0')}`,
  nameEn: '',
  count: i + 1, // tag 13 - самый популярный, tag 01 - самый непопулярный
}));

describe('компактный вид и «Ещё N»', () => {
  beforeEach(() => {
    categories = [{ id: 10, name: 'character', nameEn: '', tags: manyTags }];
  });

  it('в компактном виде популярные теги, остальные за «Ещё N»', async () => {
    mount();
    const section = await screen.findByRole('region', { name: 'Категория character' });
    expect(within(section).getAllByRole('button', { name: /^tag/ })).toHaveLength(10);
    expect(within(section).getByRole('button', { name: 'Ещё 3…' })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'tag 01 1' })).toBeNull();
  });

  it('«Ещё N» раскрывает полный список, «Свернуть» возвращает компактный вид', async () => {
    const { user } = mount();
    const section = await screen.findByRole('region', { name: 'Категория character' });
    await user.click(within(section).getByRole('button', { name: 'Ещё 3…' }));
    expect(within(section).getAllByRole('button', { name: /^tag/ })).toHaveLength(13);
    await user.click(within(section).getByRole('button', { name: 'Свернуть' }));
    expect(within(section).getAllByRole('button', { name: /^tag/ })).toHaveLength(10);
  });

  it('сворачивание категории запоминается в localStorage и переживает перемонтирование', async () => {
    const { user, unmount } = mount();
    const header = await screen.findByRole('button', { name: 'character 13' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^tag/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem('test-catalog')!)).toEqual({ collapsed: [10], full: [] });

    unmount();
    mount();
    expect(await screen.findByRole('button', { name: 'character 13' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^tag/ })).toBeNull();
  });
});

describe('выбранные теги', () => {
  beforeEach(() => {
    categories = [
      {
        id: 10,
        name: 'character',
        nameEn: '',
        tags: [
          { id: 1, categoryId: 10, name: 'eris', nameEn: '', count: 5 },
          { id: 2, categoryId: 10, name: 'roxy', nameEn: '', count: 3 },
          { id: 3, categoryId: 10, name: 'hinata', nameEn: '', count: 0 },
          { id: 4, categoryId: 10, name: 'aqua', nameEn: '', count: 1 },
        ],
      },
      { id: 20, name: 'language', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 0 }] },
    ];
  });

  it('выбранный тег остаётся на месте и подсвечен; клик переключает', async () => {
    const { onToggle, user } = mount(new Set([2]), 2);
    const section = await screen.findByRole('region', { name: 'Категория character' });
    // порядок только по счётчикам: eris и roxy в компактном виде, roxy выбран
    expect(within(section).getByRole('button', { name: 'eris 5' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByRole('button', { name: 'roxy 3' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(section).getByRole('button', { name: 'roxy 3' }));
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it('выбранный тег с малым счётчиком не лезет в компактный вид - за «Ещё N»', async () => {
    mount(new Set([3]), 2);
    const section = await screen.findByRole('region', { name: 'Категория character' });
    expect(within(section).queryByRole('button', { name: 'hinata 0' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Ещё 2…' })).toBeInTheDocument();
  });

  it('у свернутой категории с выбранными - точка-метка, без выбранных - нет', async () => {
    const { user } = mount(new Set([5]), 2);
    const header = await screen.findByRole('button', { name: 'language 1' });
    await user.click(header);
    expect(within(header).getByTitle('Есть выбранные теги')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'character 4' })).queryByTitle('Есть выбранные теги'),
    ).toBeNull();
  });
});

describe('поиск по имени', () => {
  beforeEach(() => {
    categories = [
      {
        id: 10,
        name: 'character',
        nameEn: '',
        tags: [
          { id: 1, categoryId: 10, name: 'eris greyrat', nameEn: '', count: 3 },
          { id: 2, categoryId: 10, name: 'roxy migurdia', nameEn: '', count: 1 },
        ],
      },
      { id: 20, name: 'language', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 4 }] },
    ];
  });

  it('находит по подстроке во всех категориях, скрывая остальные; очистка возвращает каталог', async () => {
    const { user } = mount();
    await user.type(await screen.findByLabelText('Фильтровать теги по имени'), 'grey');
    expect(await screen.findByRole('button', { name: 'eris greyrat 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'roxy migurdia 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ru 4' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Очистить фильтр тегов' }));
    expect(await screen.findByRole('button', { name: 'ru 4' })).toBeInTheDocument();
  });

  it('нет совпадений - «Ничего не найдено»', async () => {
    const { user } = mount();
    await user.type(await screen.findByLabelText('Фильтровать теги по имени'), 'zzz');
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();
  });
});

describe('пустые состояния', () => {
  it('каталог пуст - «Тегов пока нет»', async () => {
    categories = [];
    mount();
    expect(await screen.findByText('Тегов пока нет')).toBeInTheDocument();
  });
});
