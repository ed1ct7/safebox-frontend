import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_FILTER } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { FilterPanel } from './TagFilter';

beforeEach(() => {
  installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }) });
});
afterEach(() => vi.unstubAllGlobals());

function Harness({
  initial = EMPTY_FILTER,
  canScopeFolder = true,
  onChange,
  onClose = vi.fn(),
}: {
  initial?: TagFilter;
  canScopeFolder?: boolean;
  onChange: (f: TagFilter) => void;
  onClose?: () => void;
}) {
  const [filter, setFilter] = useState(initial);
  return (
    <FilterPanel
      filter={filter}
      canScopeFolder={canScopeFolder}
      onChange={(f) => {
        onChange(f);
        setFilter(f);
      }}
      onClose={onClose}
    />
  );
}

function mount(props: { initial?: TagFilter; canScopeFolder?: boolean; onClose?: () => void } = {}) {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} {...props} />, { wrapper: makeWrapper().Wrapper });
  const panel = screen.getByRole('complementary', { name: 'Фильтр по тегам' });
  return { panel, onChange, user: userEvent.setup() };
}

describe('FilterPanel: каталог тегов', () => {
  it('все категории и теги со счётчиками - выбирать можно без ввода', async () => {
    const { panel } = mount();
    const character = await within(panel).findByRole('region', { name: 'Категория character' });
    expect(within(character).getByRole('button', { name: /eris greyrat/ })).toHaveTextContent('3');
    expect(within(character).getByRole('button', { name: /roxy migurdia/ })).toHaveTextContent('1');
    expect(within(panel).getByRole('region', { name: 'Категория language' })).toBeInTheDocument();
  });

  it('клик по тегу добавляет его в фильтр и подсвечивает в каталоге', async () => {
    const { panel, onChange, user } = mount();
    const character = await within(panel).findByRole('region', { name: 'Категория character' });
    const tag = within(character).getByRole('button', { name: /eris greyrat/ });
    await user.click(tag);
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'vault' });
    expect(tag).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('list', { name: 'Выбранные теги' })).toHaveTextContent('character: eris greyrat');
  });

  it('повторный клик по выбранному тегу убирает его', async () => {
    const { panel, onChange, user } = mount({ initial: { ...EMPTY_FILTER, tags: [1] } });
    const character = await within(panel).findByRole('region', { name: 'Категория character' });
    await user.click(within(character).getByRole('button', { name: /eris greyrat/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [], match: 'categories', scope: 'vault' });
  });

  it('выбор через поле с автодополнением тоже работает', async () => {
    const { panel, onChange, user } = mount();
    await user.type(within(panel).getByRole('combobox'), 'eris');
    await user.click(await within(panel).findByRole('option', { name: /character: eris greyrat/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'vault' });
    expect(within(panel).getByRole('list', { name: 'Выбранные теги' })).toHaveTextContent('character: eris greyrat');
  });
});

describe('FilterPanel: режимы', () => {
  it('по умолчанию: «И между категориями, ИЛИ внутри», весь сейф', async () => {
    const { panel } = mount();
    const match = within(panel).getByRole('radiogroup', { name: 'Сочетание тегов' });
    expect(within(match).getByRole('radio', { name: 'И между категориями, ИЛИ внутри' })).toBeChecked();
    expect(within(match).getByRole('radio', { name: 'Все И' })).not.toBeChecked();
    expect(within(match).getByRole('radio', { name: 'Все ИЛИ' })).not.toBeChecked();
    const scope = within(panel).getByRole('radiogroup', { name: 'Область поиска' });
    expect(within(scope).getByRole('radio', { name: 'Весь сейф' })).toBeChecked();
  });

  it('создавать теги здесь нельзя: вместо «Создать…» - «такого тега нет»', async () => {
    const { panel, onChange, user } = mount();
    await user.type(within(panel).getByRole('combobox'), 'место:Рим');
    expect(await within(panel).findByText('Такого тега нет')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('уже выбранный тег повторно не предлагается', async () => {
    const { panel, user } = mount({ initial: { ...EMPTY_FILTER, tags: [5] } });
    await user.type(within(panel).getByRole('combobox'), 'language:ru');
    expect(await within(panel).findByText('Этот тег уже добавлен')).toBeInTheDocument();
  });

  it('режим сочетания переключается, теги и область сохраняются', async () => {
    const { panel, onChange, user } = mount({ initial: { ...EMPTY_FILTER, tags: [1, 5] } });
    await user.click(within(panel).getByRole('radio', { name: 'Все И' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1, 5], match: 'all', scope: 'vault' });
    await user.click(within(panel).getByRole('radio', { name: 'Все ИЛИ' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1, 5], match: 'any', scope: 'vault' });
  });

  it('область: «В этой папке» доступна, если открыта папка', async () => {
    const { panel, onChange, user } = mount({ initial: { ...EMPTY_FILTER, tags: [1] } });
    await user.click(within(panel).getByRole('radio', { name: 'В этой папке' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'folder' });
  });

  it('в корне «В этой папке» недоступна, действует весь сейф', async () => {
    const { panel } = mount({ initial: { tags: [1], match: 'categories', scope: 'folder' }, canScopeFolder: false });
    expect(within(panel).getByRole('radio', { name: 'В этой папке' })).toBeDisabled();
    expect(within(panel).getByRole('radio', { name: 'Весь сейф' })).toBeChecked();
  });
});

describe('FilterPanel: выбранные и закрытие', () => {
  it('крестик убирает тег из фильтра, «Сбросить» - все, режим остаётся', async () => {
    const { panel, onChange, user } = mount({ initial: { tags: [1, 5], match: 'all', scope: 'vault' } });
    await user.click(
      await within(panel).findByRole('button', { name: 'Убрать из фильтра «character: eris greyrat»' }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ tags: [5], match: 'all', scope: 'vault' });
    await user.click(within(panel).getByRole('button', { name: 'Сбросить фильтр' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [], match: 'all', scope: 'vault' });
  });

  it('✕ в заголовке закрывает панель', async () => {
    const onClose = vi.fn();
    const { panel, user } = mount({ onClose });
    await user.click(within(panel).getByRole('button', { name: 'Закрыть панель фильтра' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
