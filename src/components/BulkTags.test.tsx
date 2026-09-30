import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeEntry } from '../test/factories';
import { apiError, installFakeServer } from '../test/fakeServer';
import type { FakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { BulkTagsButton } from './BulkTags';

let server: FakeServer;

beforeEach(() => {
  server = installFakeServer({
    'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }),
    'POST /api/v1/entries/tags': () => ({ json: { updated: 2 } }),
  });
});
afterEach(() => vi.unstubAllGlobals());

// eris - у двух из трёх, ru - у одной (наследуемый), у третьей своих тегов нет
const entries = [
  makeEntry({ id: 1, tags: [{ tagId: 1, inherit: false }, { tagId: 5, inherit: true }] }),
  makeEntry({ id: 2, tags: [{ tagId: 1, inherit: false }] }),
  makeEntry({ id: 3, inheritedTags: [{ tagId: 2, fromId: 99 }] }),
];

async function open() {
  render(<BulkTagsButton entries={entries} className="btn" />, { wrapper: makeWrapper().Wrapper });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Теги…' }));
  const popover = await screen.findByRole('group', { name: 'Теги выделенных записей' });
  return { popover, user };
}

const assignCalls = () => server.callsTo('POST', '/api/v1/entries/tags');

describe('BulkTagsButton', () => {
  it('поповер: поле ввода и теги выделенных с числом записей', async () => {
    const { popover } = await open();
    expect(within(popover).getByRole('combobox', { name: 'Добавить тег выделенным' })).toHaveFocus();
    expect(within(popover).getByText('Теги: 3 записи')).toBeInTheDocument();
    const rows = await within(popover).findAllByRole('listitem');
    expect(rows).toHaveLength(2); // унаследованный тег третьей записи не в счёт
    expect(rows[0]).toHaveTextContent('character: eris greyrat');
    expect(rows[0]).toHaveTextContent('2 из 3');
    expect(rows[1]).toHaveTextContent('language: ru');
    expect(rows[1]).toHaveTextContent('1 из 3');
  });

  it('добавить тег всем: POST /entries/tags для всех выделенных, тост', async () => {
    const { popover, user } = await open();
    await user.type(within(popover).getByRole('combobox'), 'roxy');
    await user.click(await screen.findByRole('option', { name: /roxy migurdia/ }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [1, 2, 3], add: [{ tagId: 2, inherit: false }] });
    expect(await screen.findByText('Тег добавлен: 2 записи')).toBeInTheDocument();
  });

  it('«Наследуется» уходит в add', async () => {
    const { popover, user } = await open();
    await user.click(within(popover).getByRole('checkbox', { name: 'Наследуется' }));
    await user.type(within(popover).getByRole('combobox'), 'language:ru{Enter}');
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [1, 2, 3], add: [{ tagId: 5, inherit: true }] });
  });

  it('снять тег, который есть хотя бы у одной записи: remove для всех выделенных', async () => {
    const { popover, user } = await open();
    await user.click(await within(popover).findByRole('button', { name: 'Снять тег «language: ru» у выделенных' }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [1, 2, 3], remove: [5] });
    expect(await screen.findByText('Тег снят: 2 записи')).toBeInTheDocument();
  });

  it('новый тег в новой категории - через подтверждение, потом всем выделенным', async () => {
    server.routes['POST /api/v1/tags'] = () => ({ status: 201, json: { id: 11, categoryId: 30, name: 'Рим' } });
    const { popover, user } = await open();
    await user.type(within(popover).getByRole('combobox'), 'место:Рим{Enter}');
    await user.click(await screen.findByRole('button', { name: /Создать тег/ }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags')[0]?.body).toEqual({
      category: 'место',
      name: 'Рим',
      createCategory: true,
    });
    expect(assignCalls()[0]?.body).toEqual({ ids: [1, 2, 3], add: [{ tagId: 11, inherit: false }] });
  });

  it('отказ сервера при снятии - под списком', async () => {
    server.routes['POST /api/v1/entries/tags'] = () => apiError(422, 'invalid_argument', 'Неизвестный тег');
    const { popover, user } = await open();
    await user.click(await within(popover).findByRole('button', { name: 'Снять тег «language: ru» у выделенных' }));
    expect(await within(popover).findByRole('alert')).toHaveTextContent('Неизвестный тег');
  });

  it('Esc (поле пусто) и клик мимо закрывают поповер', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}'); // поле с фокусом: сначала закрываются подсказки
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Escape}'); // теперь сам поповер
    expect(screen.queryByRole('group', { name: 'Теги выделенных записей' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Теги…' }));
    await screen.findByRole('group', { name: 'Теги выделенных записей' });
    await user.click(document.body);
    expect(screen.queryByRole('group', { name: 'Теги выделенных записей' })).toBeNull();
  });
});
