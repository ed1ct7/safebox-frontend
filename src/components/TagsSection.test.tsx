import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '../api/types';
import { makeEntry } from '../test/factories';
import { apiError, installFakeServer } from '../test/fakeServer';
import type { FakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { TagsSection } from './TagsSection';

let server: FakeServer;

beforeEach(() => {
  server = installFakeServer({
    'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }),
    'POST /api/v1/entries/tags': () => ({ json: { updated: 1 } }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const entryWith = (extra: Partial<Entry> = {}) =>
  makeEntry({
    id: 7,
    tags: [
      { tagId: 1, inherit: false },
      { tagId: 5, inherit: true },
    ],
    ...extra,
  });

async function setup(entry: Entry = entryWith(), extra: { sourceNames?: Map<number, string> } = {}) {
  const onOpenSource = vi.fn();
  const view = render(
    <TagsSection entry={entry} sourceNames={extra.sourceNames ?? new Map()} onOpenSource={onOpenSource} />,
    { wrapper: makeWrapper().Wrapper },
  );
  const region = screen.getByRole('region', { name: 'Теги' });
  return { region, onOpenSource, user: userEvent.setup(), ...view };
}

const assignCalls = () => server.callsTo('POST', '/api/v1/entries/tags');

describe('TagsSection: теги записи', () => {
  it('сгруппированы по категориям, чипы «категория: тег»', async () => {
    const { region } = await setup();
    expect(await within(region).findByRole('button', { name: 'Снять тег «character: eris greyrat»' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Снять тег «language: ru»' })).toBeInTheDocument();
    const rows = region.querySelectorAll('div.flex-wrap');
    expect(rows).toHaveLength(2); // character, language
    expect(rows[0]).toHaveTextContent('character: eris greyrat');
    expect(rows[1]).toHaveTextContent('language: ru');
  });

  it('нет тегов - подсказка', async () => {
    const { region } = await setup(makeEntry({ id: 7 }));
    expect(within(region).getByText('Тегов пока нет')).toBeInTheDocument();
  });

  it('унаследованный тег: бледный, «от: <имя>», без крестика, клик ведёт к источнику', async () => {
    const entry = entryWith({ tags: [], inheritedTags: [{ tagId: 2, fromId: 77 }] });
    const { region, user, onOpenSource } = await setup(entry, { sourceNames: new Map([[77, 'Отпуск']]) });
    const chip = await within(region).findByTitle('от: Отпуск');
    expect(chip).toHaveTextContent('character: roxy migurdia');
    expect(chip.className).toMatch(/opacity-70/);
    // ни крестика, ни переключателя наследования: снимается только у записи-источника
    expect(within(region).queryByRole('button', { name: /Снять тег/ })).toBeNull();
    expect(within(region).queryByRole('button', { name: /^Наследуется:/ })).toBeNull();
    await user.click(chip);
    expect(onOpenSource).toHaveBeenCalledWith(77);
    expect(assignCalls()).toHaveLength(0);
  });

  it('имени источника нет среди крошек - берём GET /entries/:id', async () => {
    server.routes['GET /api/v1/entries/77'] = () => ({ json: makeEntry({ id: 77, name: 'Море', kind: 'folder' }) });
    const entry = entryWith({ tags: [], inheritedTags: [{ tagId: 2, fromId: 77 }] });
    const { region } = await setup(entry);
    expect(await within(region).findByTitle('от: Море')).toBeInTheDocument();
    expect(server.callsTo('GET', '/api/v1/entries/77')).toHaveLength(1);
  });

  it('имя источника известно - лишнего запроса нет', async () => {
    const entry = entryWith({ tags: [], inheritedTags: [{ tagId: 2, fromId: 77 }] });
    const { region } = await setup(entry, { sourceNames: new Map([[77, 'Отпуск']]) });
    await within(region).findByTitle('от: Отпуск');
    expect(server.callsTo('GET', '/api/v1/entries/77')).toHaveLength(0);
  });

  it('унаследованный и прямой теги одной категории - в одном ряду, прямые первыми', async () => {
    const entry = entryWith({ tags: [{ tagId: 2, inherit: false }], inheritedTags: [{ tagId: 1, fromId: 9 }] });
    const { region } = await setup(entry, { sourceNames: new Map([[9, 'Папка']]) });
    await within(region).findByTitle('от: Папка');
    const rows = region.querySelectorAll('div.flex-wrap');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/roxy migurdia.*eris greyrat/);
  });
});

describe('TagsSection: снять тег и наследование', () => {
  it('крестик снимает прямой тег: POST /entries/tags с remove', async () => {
    const { region, user } = await setup();
    await user.click(await within(region).findByRole('button', { name: 'Снять тег «character: eris greyrat»' }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], remove: [1] });
  });

  it('кнопка наследования переключает inherit повторным add', async () => {
    const { region, user } = await setup();
    const off = await within(region).findByRole('button', { name: 'Наследуется: character: eris greyrat' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    await user.click(off);
    const on = within(region).getByRole('button', { name: 'Наследуется: language: ru' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    await user.click(on);
    await waitFor(() => expect(assignCalls()).toHaveLength(2));
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 1, inherit: true }] });
    expect(assignCalls()[1]?.body).toEqual({ ids: [7], add: [{ tagId: 5, inherit: false }] });
  });

  it('после присвоения обновляются каталог (счётчики) и записи', async () => {
    const { region, user } = await setup();
    await user.click(await within(region).findByRole('button', { name: 'Снять тег «language: ru»' }));
    await waitFor(() => expect(server.callsTo('GET', '/api/v1/tags').length).toBeGreaterThanOrEqual(2));
  });

  it('отказ сервера при снятии - под секцией', async () => {
    server.routes['POST /api/v1/entries/tags'] = () => apiError(422, 'invalid_argument', 'Неизвестный тег');
    const { region, user } = await setup();
    await user.click(await within(region).findByRole('button', { name: 'Снять тег «language: ru»' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('Неизвестный тег');
  });
});

describe('TagsSection: добавление', () => {
  it('существующий тег: ввод, Enter -> add с inherit: false', async () => {
    const { region, user } = await setup(makeEntry({ id: 7 }));
    const box = within(region).getByRole('combobox', { name: 'Добавить тег' });
    await user.type(box, 'roxy');
    await user.click(await screen.findByRole('option', { name: /character: roxy migurdia/ }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 2, inherit: false }] });
    expect(box).toHaveValue('');
  });

  it('«Наследуется» - выключен по умолчанию, включённый уходит в add', async () => {
    const { region, user } = await setup(makeEntry({ id: 7 }));
    const inherit = within(region).getByRole('checkbox', { name: 'Наследуется' });
    expect(inherit).not.toBeChecked();
    await user.click(inherit);
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'language:ru');
    await screen.findByRole('option', { name: /language: ru/ });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 5, inherit: true }] });
  });

  it('уже висящий тег не предлагается повторно (но «Создать тег …» остаётся)', async () => {
    const { region, user } = await setup();
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'eris');
    await screen.findByText('Этот тег уже добавлен');
    expect(screen.getByRole('option', { name: 'Создать тег eris…' })).toBeInTheDocument();
  });

  it('нет тега в существующей категории: POST /tags, потом add', async () => {
    server.routes['POST /api/v1/tags'] = () => ({ status: 201, json: { id: 9, categoryId: 10, name: 'sylphy' } });
    const { region, user } = await setup(makeEntry({ id: 7 }));
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'character:sylphy');
    await user.click(await screen.findByRole('option', { name: 'Создать тег sylphy в категории character' }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags')[0]?.body).toEqual({ category: 'character', name: 'sylphy' });
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 9, inherit: false }] });
  });

  it('нет и категории: панель с вписанной категорией, потом POST /tags с createCategory: true и add', async () => {
    server.routes['POST /api/v1/tags'] = () => ({ status: 201, json: { id: 11, categoryId: 30, name: 'Рим' } });
    const { region, user } = await setup(makeEntry({ id: 7 }));
    await user.click(within(region).getByRole('checkbox', { name: 'Наследуется' }));
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'место:Рим');
    await user.click(await screen.findByRole('option', { name: 'Создать категорию место и тег Рим' }));
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    expect(within(panel).getByRole('textbox', { name: 'Новая категория' })).toHaveValue('место');
    expect(server.callsTo('POST', '/api/v1/tags')).toHaveLength(0); // без «Создать» ничего не создано
    await user.click(within(panel).getByRole('button', { name: /Создать тег/ }));
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags')[0]?.body).toEqual({
      category: 'место',
      name: 'Рим',
      createCategory: true,
    });
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 11, inherit: true }] });
  });

  it('тег уже был (200) - просто присваивается', async () => {
    server.routes['POST /api/v1/tags'] = () => ({ status: 200, json: { id: 2, categoryId: 10, name: 'roxy migurdia' } });
    const { region, user } = await setup(makeEntry({ id: 7 }));
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'character:sylphy{Enter}');
    await waitFor(() => expect(assignCalls()).toHaveLength(1));
    expect(assignCalls()[0]?.body).toEqual({ ids: [7], add: [{ tagId: 2, inherit: false }] });
  });

  it('422 при создании - под полем, присвоения нет', async () => {
    server.routes['POST /api/v1/tags'] = () => apiError(422, 'invalid_argument', 'Имя тега слишком длинное');
    const { region, user } = await setup(makeEntry({ id: 7 }));
    const box = within(region).getByRole('combobox', { name: 'Добавить тег' });
    await user.type(box, 'character:sylphy{Enter}');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Имя тега слишком длинное');
    expect(assignCalls()).toHaveLength(0);
    expect(box).toHaveValue('character:sylphy');
  });

  it('«:» в имени - сообщение в поле, запросов нет', async () => {
    const { region, user } = await setup(makeEntry({ id: 7 }));
    await user.type(within(region).getByRole('combobox', { name: 'Добавить тег' }), 'character:a:b{Enter}');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Символ «:» в имени тега запрещён');
    expect(server.callsTo('POST', '/api/v1/tags')).toHaveLength(0);
    expect(assignCalls()).toHaveLength(0);
  });
});
