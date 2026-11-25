import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_FILTER } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { FilterBar } from './TagFilter';

beforeEach(() => {
  installFakeServer({
    'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }),
    'GET /api/v1/folders': () => ({ json: { folders: [{ id: 7, parentId: null, name: 'Поездки' }] } }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function Harness({
  initial,
  folderId,
  onChange,
}: {
  initial: TagFilter;
  folderId: number | null;
  onChange: (f: TagFilter) => void;
}) {
  const [filter, setFilter] = useState(initial);
  return (
    <FilterBar
      filter={filter}
      folderId={folderId}
      onChange={(f) => {
        onChange(f);
        setFilter(f);
      }}
    />
  );
}

function mount(initial: TagFilter, folderId: number | null = 7) {
  const onChange = vi.fn();
  render(<Harness initial={initial} folderId={folderId} onChange={onChange} />, { wrapper: makeWrapper().Wrapper });
  const bar = screen.getByRole('region', { name: 'Фильтр по тегам' });
  return { bar, onChange, user: userEvent.setup() };
}

describe('FilterBar: что выбрано', () => {
  it('теги фразой по категориям: внутри «или», между «и»', async () => {
    const { bar } = mount({ ...EMPTY_FILTER, tags: [1, 5, 2] });
    const list = within(bar).getByRole('list', { name: 'Выбранные теги' });
    await within(list).findByText('eris greyrat');
    expect(list).toHaveTextContent('character:eris greyrat✕илиroxy migurdia✕иlanguage:ru✕');
  });

  it('«Все И» - «и» везде, «Все ИЛИ» - «или» везде', async () => {
    const { bar, user } = mount({ tags: [1, 2, 5], match: 'all', scope: 'vault' });
    const list = within(bar).getByRole('list', { name: 'Выбранные теги' });
    await within(list).findByText('eris greyrat');
    expect(list).toHaveTextContent('eris greyrat✕иroxy migurdia✕иlanguage');
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Сочетание тегов' }), 'any');
    expect(list).toHaveTextContent('eris greyrat✕илиroxy migurdia✕илиlanguage');
  });

  it('крестик убирает тег, «Сбросить» - все, режим и область остаются', async () => {
    const { bar, onChange, user } = mount({ tags: [1, 5], match: 'all', scope: 'folder' });
    await user.click(await within(bar).findByRole('button', { name: 'Убрать из фильтра «character: eris greyrat»' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [5], match: 'all', scope: 'folder' });
    await user.click(within(bar).getByRole('button', { name: 'Сбросить' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [], match: 'all', scope: 'folder' });
  });
});

describe('FilterBar: «+ тег»', () => {
  it('добавляет тег через поле с подсказками', async () => {
    const { bar, onChange, user } = mount({ ...EMPTY_FILTER, tags: [5] });
    await user.click(within(bar).getByRole('button', { name: '+ тег' }));
    await user.type(within(bar).getByRole('combobox', { name: 'Добавить тег в фильтр' }), 'eris');
    await user.click(await within(bar).findByRole('option', { name: /character: eris greyrat/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [5, 1], match: 'categories', scope: 'vault' });
    expect(within(bar).queryByRole('combobox', { name: 'Добавить тег в фильтр' })).toBeNull();
  });

  it('создавать теги здесь нельзя, выбранный повторно не предлагается', async () => {
    const { bar, onChange, user } = mount({ ...EMPTY_FILTER, tags: [5] });
    await user.click(within(bar).getByRole('button', { name: '+ тег' }));
    const input = within(bar).getByRole('combobox', { name: 'Добавить тег в фильтр' });
    await user.type(input, 'место:Рим');
    expect(await within(bar).findByText('Такого тега нет')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'language:ru');
    expect(await within(bar).findByText('Этот тег уже добавлен')).toBeInTheDocument();
  });
});

describe('FilterBar: сочетание и область', () => {
  it('по умолчанию: «И между категориями, ИЛИ внутри», весь сейф', () => {
    const { bar } = mount({ ...EMPTY_FILTER, tags: [1] });
    expect(within(bar).getByRole('combobox', { name: 'Сочетание тегов' })).toHaveValue('categories');
    const scope = within(bar).getByRole('radiogroup', { name: 'Область поиска' });
    expect(within(scope).getByRole('radio', { name: 'Весь сейф' })).toHaveAttribute('aria-checked', 'true');
  });

  it('сочетание переключается, теги и область сохраняются', async () => {
    const { bar, onChange, user } = mount({ ...EMPTY_FILTER, tags: [1, 5] });
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Сочетание тегов' }), 'all');
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1, 5], match: 'all', scope: 'vault' });
  });

  it('область: открытая папка - с её именем', async () => {
    const { bar, onChange, user } = mount({ ...EMPTY_FILTER, tags: [1] });
    await user.click(await within(bar).findByRole('radio', { name: 'В «Поездки»' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'folder' });
  });

  it('в корне «в папке» недоступна, действует весь сейф', () => {
    const { bar } = mount({ tags: [1], match: 'categories', scope: 'folder' }, null);
    expect(within(bar).getByRole('radio', { name: 'В этой папке' })).toBeDisabled();
    expect(within(bar).getByRole('radio', { name: 'Весь сейф' })).toHaveAttribute('aria-checked', 'true');
  });
});
