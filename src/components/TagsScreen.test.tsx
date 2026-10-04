import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category } from '../api/types';
import { apiError, installFakeServer } from '../test/fakeServer';
import type { FakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { TagsScreen } from './TagsScreen';

let server: FakeServer;
let categories: Category[];
let tagLanguage: 'ru' | 'en';

beforeEach(() => {
  categories = makeCategories();
  tagLanguage = 'ru';
  server = installFakeServer({
    'GET /api/v1/tags': () => ({ json: { categories } }),
    'GET /api/v1/settings': () => ({ json: { linkPreviews: true, tagLanguage } }),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function setup(firstCategory = 'character') {
  const onBack = vi.fn();
  const onFilter = vi.fn();
  render(<TagsScreen onBack={onBack} onFilter={onFilter} />, { wrapper: makeWrapper().Wrapper });
  const user = userEvent.setup();
  const screenRegion = screen.getByRole('region', { name: 'Управление тегами' });
  await within(screenRegion).findByRole('region', { name: `Категория ${firstCategory}` });
  return { onBack, onFilter, user, screenRegion };
}

const category = (name: string) => screen.getByRole('region', { name: `Категория ${name}` });

describe('TagsScreen: список', () => {
  it('категории с тегами и счётчиками записей', async () => {
    await setup();
    const character = category('character');
    const items = within(character).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('eris greyrat');
    expect(items[0]).toHaveTextContent('3');
    expect(items[1]).toHaveTextContent('roxy migurdia');
    expect(within(character).getByText('2 тега')).toBeInTheDocument();
    expect(within(category('language')).getByText('1 тег')).toBeInTheDocument();
  });

  it('пустой сейф - подсказка создать категорию', async () => {
    categories = [];
    render(<TagsScreen onBack={vi.fn()} onFilter={vi.fn()} />, { wrapper: makeWrapper().Wrapper });
    expect(await screen.findByText(/Категорий пока нет/)).toBeInTheDocument();
  });

  it('клик по тегу открывает фильтр по нему', async () => {
    const { user, onFilter } = await setup();
    await user.click(screen.getByRole('button', { name: 'Показать записи с тегом «language: ru»' }));
    expect(onFilter).toHaveBeenCalledWith(5);
  });

  it('«Назад» и Esc возвращают к галерее', async () => {
    const { user, onBack } = await setup();
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('TagsScreen: категории', () => {
  it('создать категорию: POST /tags/categories', async () => {
    server.routes['POST /api/v1/tags/categories'] = () => ({ status: 201, json: { id: 30, name: 'место', nameEn: '', tags: [] } });
    const { user } = await setup();
    await user.type(screen.getByRole('textbox', { name: 'Название новой категории' }), 'место');
    await user.click(screen.getByRole('button', { name: 'Создать категорию' }));
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/tags/categories')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags/categories')[0]?.body).toEqual({ name: 'место' });
    expect(screen.getByRole('textbox', { name: 'Название новой категории' })).toHaveValue('');
  });

  it('«:» в имени - сообщение, запроса нет; дубль (409) - сообщение сервера', async () => {
    server.routes['POST /api/v1/tags/categories'] = () => apiError(409, 'already_exists', 'Такая категория уже есть');
    const { user } = await setup();
    const box = screen.getByRole('textbox', { name: 'Название новой категории' });
    await user.type(box, 'a:b{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Символ «:» в имени категории запрещён');
    expect(server.callsTo('POST', '/api/v1/tags/categories')).toHaveLength(0);
    await user.clear(box);
    await user.type(box, 'language{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Такая категория уже есть');
  });

  it('переименовать на месте: Enter -> PATCH', async () => {
    server.routes['PATCH /api/v1/tags/categories/10'] = () => ({ json: { id: 10, name: 'персонаж', nameEn: '', tags: [] } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать категорию «character»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя категории' });
    expect(box).toHaveValue('character');
    await user.clear(box);
    await user.type(box, 'персонаж{Enter}');
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/tags/categories/10')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/tags/categories/10')[0]?.body).toEqual({ name: 'персонаж' });
    expect(screen.queryByRole('textbox', { name: 'Новое имя категории' })).toBeNull();
  });

  it('переименование: Esc отменяет без запроса, дубль оставляет поле с сообщением', async () => {
    server.routes['PATCH /api/v1/tags/categories/10'] = () => apiError(409, 'already_exists', 'Категория уже есть');
    const { user, onBack } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать категорию «character»' }));
    await user.type(screen.getByRole('textbox', { name: 'Новое имя категории' }), 'x{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Новое имя категории' })).toBeNull();
    expect(server.callsTo('PATCH', '/api/v1/tags/categories/10')).toHaveLength(0);
    expect(onBack).not.toHaveBeenCalled(); // Esc отменил правку, а не закрыл экран

    await user.click(screen.getByRole('button', { name: 'Переименовать категорию «character»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя категории' });
    await user.clear(box);
    await user.type(box, 'language{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Категория уже есть');
    expect(box).toHaveValue('language');
  });

  it('удаление - с подтверждением, числом тегов и записей', async () => {
    server.routes['DELETE /api/v1/tags/categories/10'] = () => ({ json: { removedTags: 2, affectedEntries: 4 } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Удалить категорию «character»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить категорию «character»?' });
    expect(dialog).toHaveTextContent('все её теги (2)');
    expect(dialog).toHaveTextContent('не более 4');
    expect(server.callsTo('DELETE', '/api/v1/tags/categories/10')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(server.callsTo('DELETE', '/api/v1/tags/categories/10')).toHaveLength(1));
    expect(await screen.findByText('Категория удалена: тегов 2, затронуто записей 4')).toBeInTheDocument();
  });

  it('отмена удаления ничего не делает', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Удалить категорию «language»' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(server.callsTo('DELETE', '/api/v1/tags/categories/20')).toHaveLength(0);
  });
});

describe('TagsScreen: теги', () => {
  it('переименовать тег на месте: PATCH /tags/:id', async () => {
    server.routes['PATCH /api/v1/tags/5'] = () => ({ json: { id: 5, categoryId: 20, name: 'русский' } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать тег «ru»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя тега' });
    await user.clear(box);
    await user.type(box, 'русский{Enter}');
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/tags/5')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/tags/5')[0]?.body).toEqual({ name: 'русский' });
  });

  it('имя занято (409) - предложение слить, «Слить» вызывает POST /tags/:id/merge', async () => {
    server.routes['PATCH /api/v1/tags/2'] = () => apiError(409, 'already_exists', 'Такой тег уже есть');
    server.routes['POST /api/v1/tags/2/merge'] = () => ({ json: { affectedEntries: 1 } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать тег «roxy migurdia»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя тега' });
    await user.clear(box);
    await user.type(box, 'Eris Greyrat{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Слить с существующим тегом?' });
    expect(dialog).toHaveTextContent('«eris greyrat» уже есть в категории «character»');
    expect(dialog).toHaveTextContent('записей: 1'); // сколько записей перейдёт
    expect(server.callsTo('POST', '/api/v1/tags/2/merge')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Слить' }));
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/tags/2/merge')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags/2/merge')[0]?.body).toEqual({ into: 1 });
    expect(await screen.findByText('Теги слиты: 1 запись затронута')).toBeInTheDocument();
  });

  it('отказ от слияния ничего не делает, тег остаётся как был', async () => {
    server.routes['PATCH /api/v1/tags/2'] = () => apiError(409, 'already_exists', 'Такой тег уже есть');
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать тег «roxy migurdia»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя тега' });
    await user.clear(box);
    await user.type(box, 'eris greyrat{Enter}');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(server.callsTo('POST', '/api/v1/tags/2/merge')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Переименовать тег «roxy migurdia»' })).toBeInTheDocument();
  });

  it('«:» в имени - сообщение в поле, запроса нет', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Переименовать тег «ru»' }));
    await user.type(screen.getByRole('textbox', { name: 'Новое имя тега' }), ':x{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Символ «:» в имени тега запрещён');
    expect(server.callsTo('PATCH', '/api/v1/tags/5')).toHaveLength(0);
  });

  it('удаление - с подтверждением и числом записей', async () => {
    server.routes['DELETE /api/v1/tags/5'] = () => ({ json: { affectedEntries: 4 } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Удалить тег «ru»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить тег «language: ru»?' });
    expect(dialog).toHaveTextContent('Тег будет снят с записей: 4');
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(server.callsTo('DELETE', '/api/v1/tags/5')).toHaveLength(1));
    expect(await screen.findByText('Тег удалён, затронуто записей: 4')).toBeInTheDocument();
  });

  it('перенос в другую категорию: PATCH categoryId', async () => {
    server.routes['PATCH /api/v1/tags/5'] = () => ({ json: { id: 5, categoryId: 10, name: 'ru' } });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Перенести тег «ru» в другую категорию' }));
    const select = screen.getByRole('combobox', { name: 'Перенести тег «ru» в категорию' });
    expect(within(select).queryByRole('option', { name: 'language' })).toBeNull(); // своя категория не предлагается
    await user.selectOptions(select, 'character');
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/tags/5')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/tags/5')[0]?.body).toEqual({ categoryId: 10 });
  });

  it('перенос в категорию, где такой тег уже есть (409) - предложение слить', async () => {
    categories = [
      { id: 10, name: 'a', nameEn: '', tags: [{ id: 1, categoryId: 10, name: 'x', nameEn: '', count: 2 }] },
      { id: 20, name: 'b', nameEn: '', tags: [{ id: 6, categoryId: 20, name: 'X', nameEn: '', count: 1 }] },
    ];
    server.routes['PATCH /api/v1/tags/6'] = () => apiError(409, 'already_exists', 'Такой тег уже есть');
    server.routes['POST /api/v1/tags/6/merge'] = () => ({ json: { affectedEntries: 1 } });
    render(<TagsScreen onBack={vi.fn()} onFilter={vi.fn()} />, { wrapper: makeWrapper().Wrapper });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Перенести тег «X» в другую категорию' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Перенести тег «X» в категорию' }), 'a');
    const dialog = await screen.findByRole('dialog', { name: 'Слить с существующим тегом?' });
    await user.click(within(dialog).getByRole('button', { name: 'Слить' }));
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/tags/6/merge')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags/6/merge')[0]?.body).toEqual({ into: 1 });
  });
});

// Второе (английское) имя тега и категории: правится на месте, пусто - «не задано»,
// PATCH уходит с одним nameEn, основное имя не трогается.
describe('TagsScreen: второе имя (EN)', () => {
  const bilingual = (): Category[] => [
    {
      id: 10,
      name: 'Персонаж',
      nameEn: 'Character',
      tags: [
        { id: 1, categoryId: 10, name: 'Хината', nameEn: 'hyuuga hinata', count: 3 },
        { id: 2, categoryId: 10, name: 'Рокси', nameEn: '', count: 1 },
      ],
    },
    { id: 20, name: 'Язык', nameEn: '', tags: [{ id: 5, categoryId: 20, name: 'ru', nameEn: '', count: 4 }] },
  ];
  const tagData = (id: number) => categories.flatMap((c) => c.tags).find((t) => t.id === id)!;
  const enOfTag = (name: string) => screen.getByRole('button', { name: `Английское имя тега «${name}»` });
  const enOfCategory = (name: string) => screen.getByRole('button', { name: `Английское имя категории «${name}»` });
  const patchCalls = (path: string) => server.callsTo('PATCH', path);

  beforeEach(() => {
    categories = bilingual();
    // сервер применяет PATCH: после него список перечитывается уже с новым именем
    server.routes['PATCH /api/v1/tags/2'] = (c) => {
      Object.assign(tagData(2), c.body);
      return { json: tagData(2) };
    };
    server.routes['PATCH /api/v1/tags/1'] = (c) => {
      Object.assign(tagData(1), c.body);
      return { json: tagData(1) };
    };
    server.routes['PATCH /api/v1/tags/categories/20'] = (c) => {
      Object.assign(categories[1]!, c.body);
      return { json: categories[1] };
    };
  });

  it('оба имени рядом; пустое второе - «EN — не задано»', async () => {
    await setup('Персонаж');
    const items = within(category('Персонаж')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Рокси'); // по подписи: Рокси, Хината
    expect(items[0]).toHaveTextContent('EN — не задано');
    expect(items[1]).toHaveTextContent('Хината');
    expect(items[1]).toHaveTextContent('hyuuga hinata');
    expect(enOfCategory('Персонаж')).toHaveTextContent('Character');
    expect(enOfCategory('Язык')).toHaveTextContent('EN — не задано');
  });

  it('второе имя тега: Enter -> PATCH только с nameEn, список обновляется', async () => {
    const { user } = await setup('Персонаж');
    await user.click(enOfTag('Рокси'));
    const box = screen.getByRole('textbox', { name: 'Английское имя тега' });
    expect(box).toHaveValue('');
    expect(box).toHaveAttribute('placeholder', 'EN — не задано');
    await user.type(box, 'roxy migurdia{Enter}');
    await waitFor(() => expect(patchCalls('/api/v1/tags/2')).toHaveLength(1));
    expect(patchCalls('/api/v1/tags/2')[0]?.body).toEqual({ nameEn: 'roxy migurdia' });
    expect(screen.queryByRole('textbox', { name: 'Английское имя тега' })).toBeNull();
    await waitFor(() => expect(enOfTag('Рокси')).toHaveTextContent('roxy migurdia'));
  });

  it('второе имя категории: PATCH /tags/categories/:id только с nameEn', async () => {
    const { user } = await setup('Персонаж');
    await user.click(enOfCategory('Язык'));
    await user.type(screen.getByRole('textbox', { name: 'Английское имя категории' }), 'Language{Enter}');
    await waitFor(() => expect(patchCalls('/api/v1/tags/categories/20')).toHaveLength(1));
    expect(patchCalls('/api/v1/tags/categories/20')[0]?.body).toEqual({ nameEn: 'Language' });
    await waitFor(() => expect(enOfCategory('Язык')).toHaveTextContent('Language'));
  });

  it('пустое значение стирает второе имя: nameEn: ""', async () => {
    const { user } = await setup('Персонаж');
    await user.click(enOfTag('Хината'));
    const box = screen.getByRole('textbox', { name: 'Английское имя тега' });
    expect(box).toHaveValue('hyuuga hinata');
    await user.clear(box);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(patchCalls('/api/v1/tags/1')).toHaveLength(1));
    expect(patchCalls('/api/v1/tags/1')[0]?.body).toEqual({ nameEn: '' });
    await waitFor(() => expect(enOfTag('Хината')).toHaveTextContent('EN — не задано'));
  });

  it('без изменений запроса нет; Esc отменяет правку, а не закрывает экран', async () => {
    const { user, onBack } = await setup('Персонаж');
    await user.click(enOfTag('Хината'));
    await user.keyboard('{Enter}'); // то же значение
    expect(screen.queryByRole('textbox', { name: 'Английское имя тега' })).toBeNull();
    await user.click(enOfTag('Рокси'));
    await user.type(screen.getByRole('textbox', { name: 'Английское имя тега' }), 'x{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Английское имя тега' })).toBeNull();
    expect(patchCalls('/api/v1/tags/1')).toHaveLength(0);
    expect(patchCalls('/api/v1/tags/2')).toHaveLength(0);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('основное имя по-прежнему уходит отдельно: PATCH только с name', async () => {
    const { user } = await setup('Персонаж');
    await user.click(screen.getByRole('button', { name: 'Переименовать тег «Рокси»' }));
    const box = screen.getByRole('textbox', { name: 'Новое имя тега' });
    await user.clear(box);
    await user.type(box, 'Рокси М{Enter}');
    await waitFor(() => expect(patchCalls('/api/v1/tags/2')).toHaveLength(1));
    expect(patchCalls('/api/v1/tags/2')[0]?.body).toEqual({ name: 'Рокси М' });
  });

  it('«:» в имени - сообщение в поле, запроса нет', async () => {
    const { user } = await setup('Персонаж');
    await user.click(enOfTag('Рокси'));
    await user.type(screen.getByRole('textbox', { name: 'Английское имя тега' }), 'a:b{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Символ «:» в имени тега запрещён');
    expect(patchCalls('/api/v1/tags/2')).toHaveLength(0);
  });

  it('отказ сервера (409) - сообщение под полем, введённый текст остаётся', async () => {
    server.routes['PATCH /api/v1/tags/categories/20'] = () => apiError(409, 'already_exists', 'Такое имя уже есть');
    const { user } = await setup('Персонаж');
    await user.click(enOfCategory('Язык'));
    const box = screen.getByRole('textbox', { name: 'Английское имя категории' });
    await user.type(box, 'Character{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Такое имя уже есть');
    expect(box).toHaveValue('Character');
  });

  it('второе имя совпало с именем другого тега (409) - предложение слить', async () => {
    server.routes['PATCH /api/v1/tags/2'] = () => apiError(409, 'already_exists', 'Такой тег уже есть');
    server.routes['POST /api/v1/tags/2/merge'] = () => ({ json: { affectedEntries: 1 } });
    const { user } = await setup('Персонаж');
    await user.click(enOfTag('Рокси'));
    await user.type(screen.getByRole('textbox', { name: 'Английское имя тега' }), 'Hyuuga Hinata{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Слить с существующим тегом?' });
    expect(dialog).toHaveTextContent('«Хината» уже есть в категории «Персонаж»');
    await user.click(within(dialog).getByRole('button', { name: 'Слить' }));
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/tags/2/merge')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/tags/2/merge')[0]?.body).toEqual({ into: 1 });
  });

  it('язык тегов en: подтверждения и выбор категории - на подписях, правка - по-прежнему по именам', async () => {
    tagLanguage = 'en';
    const { user } = await setup('Персонаж');
    // подпись тега в en: «Character: hyuuga hinata» (у «Рокси» второго имени нет - основное)
    await user.click(await screen.findByRole('button', { name: 'Показать записи с тегом «Character: hyuuga hinata»' }));
    await user.click(screen.getByRole('button', { name: 'Удалить тег «Хината»' }));
    expect(await screen.findByRole('dialog', { name: 'Удалить тег «Character: hyuuga hinata»?' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));

    await user.click(screen.getByRole('button', { name: 'Перенести тег «ru» в другую категорию' }));
    const select = screen.getByRole('combobox', { name: 'Перенести тег «ru» в категорию' });
    expect(within(select).getByRole('option', { name: 'Character' })).toBeInTheDocument();
    expect(enOfTag('Хината')).toHaveTextContent('hyuuga hinata');
  });
});
