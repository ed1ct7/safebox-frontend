import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_FILTER } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { TagFilterButton } from './TagFilter';

beforeEach(() => {
  installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }) });
});
afterEach(() => vi.unstubAllGlobals());

function Harness({
  initial = EMPTY_FILTER,
  canScopeFolder = true,
  onChange,
}: {
  initial?: TagFilter;
  canScopeFolder?: boolean;
  onChange: (f: TagFilter) => void;
}) {
  const [filter, setFilter] = useState(initial);
  return (
    <TagFilterButton
      filter={filter}
      canScopeFolder={canScopeFolder}
      className="btn"
      onChange={(f) => {
        onChange(f);
        setFilter(f);
      }}
    />
  );
}

async function open(props: { initial?: TagFilter; canScopeFolder?: boolean } = {}) {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} {...props} />, { wrapper: makeWrapper().Wrapper });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Фильтр/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Фильтр по тегам' });
  return { dialog, onChange, user };
}

describe('TagFilterButton', () => {
  it('по умолчанию: «И между категориями, ИЛИ внутри», весь сейф', async () => {
    const { dialog } = await open();
    const match = within(dialog).getByRole('radiogroup', { name: 'Сочетание тегов' });
    expect(within(match).getByRole('radio', { name: 'И между категориями, ИЛИ внутри' })).toBeChecked();
    expect(within(match).getByRole('radio', { name: 'Все И' })).not.toBeChecked();
    expect(within(match).getByRole('radio', { name: 'Все ИЛИ' })).not.toBeChecked();
    const scope = within(dialog).getByRole('radiogroup', { name: 'Область поиска' });
    expect(within(scope).getByRole('radio', { name: 'Весь сейф' })).toBeChecked();
  });

  it('выбор тега добавляет его в фильтр и показывает чипом', async () => {
    const { dialog, onChange, user } = await open();
    await user.type(within(dialog).getByRole('combobox'), 'eris');
    await user.click(await screen.findByRole('option', { name: /character: eris greyrat/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'vault' });
    const chips = within(dialog).getByRole('list', { name: 'Выбранные теги' });
    expect(chips).toHaveTextContent('character: eris greyrat');
    expect(screen.getByLabelText('Выбрано тегов: 1')).toBeInTheDocument();
  });

  it('создавать теги здесь нельзя: вместо «Создать…» - «такого тега нет»', async () => {
    const { dialog, onChange, user } = await open();
    await user.type(within(dialog).getByRole('combobox'), 'место:Рим');
    expect(await screen.findByText('Такого тега нет')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('уже выбранный тег повторно не предлагается', async () => {
    const { dialog, user } = await open({ initial: { ...EMPTY_FILTER, tags: [5] } });
    await user.type(within(dialog).getByRole('combobox'), 'language:ru');
    expect(await screen.findByText('Этот тег уже добавлен')).toBeInTheDocument();
  });

  it('режим сочетания переключается, теги и область сохраняются', async () => {
    const { dialog, onChange, user } = await open({ initial: { ...EMPTY_FILTER, tags: [1, 5] } });
    await user.click(within(dialog).getByRole('radio', { name: 'Все И' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1, 5], match: 'all', scope: 'vault' });
    await user.click(within(dialog).getByRole('radio', { name: 'Все ИЛИ' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1, 5], match: 'any', scope: 'vault' });
  });

  it('область: «В этой папке» доступна, если открыта папка', async () => {
    const { dialog, onChange, user } = await open({ initial: { ...EMPTY_FILTER, tags: [1] } });
    await user.click(within(dialog).getByRole('radio', { name: 'В этой папке' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [1], match: 'categories', scope: 'folder' });
  });

  it('в корне «В этой папке» недоступна, действует весь сейф', async () => {
    const { dialog } = await open({ initial: { tags: [1], match: 'categories', scope: 'folder' }, canScopeFolder: false });
    expect(within(dialog).getByRole('radio', { name: 'В этой папке' })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: 'Весь сейф' })).toBeChecked();
  });

  it('крестик убирает тег из фильтра, «Сбросить» - все, режим остаётся', async () => {
    const { dialog, onChange, user } = await open({ initial: { tags: [1, 5], match: 'all', scope: 'vault' } });
    await user.click(within(dialog).getByRole('button', { name: 'Убрать из фильтра «character: eris greyrat»' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [5], match: 'all', scope: 'vault' });
    await user.click(within(dialog).getByRole('button', { name: 'Сбросить фильтр' }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [], match: 'all', scope: 'vault' });
  });

  it('Esc закрывает поповер', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Фильтр по тегам' })).toBeNull();
  });
});
