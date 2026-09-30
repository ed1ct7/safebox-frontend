import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setToken } from '../api/client';
import type { Category, Listing } from '../api/types';
import { makeEntry } from '../test/factories';
import { installFakeServer } from '../test/fakeServer';
import type { FakeServer, Handler } from '../test/fakeServer';
import { MainShell } from './MainShell';
import { ToastProvider } from './Toasts';

// Теги и фильтр в главном окне на подставном сервере (UF-16, UF-17, UF-18):
// теги на карточках, «Теги…», массовые теги, фильтр -> GET /search, экран «Теги».

let categories: Category[];

const folder = makeEntry({ id: 3, kind: 'folder', name: 'Папка', childCount: 1 });
const photo = makeEntry({ id: 1, kind: 'photo', name: 'кот.jpg', tags: [{ tagId: 1, inherit: false }] });
const link = makeEntry({
  id: 2,
  kind: 'link',
  name: 'Пример',
  url: 'https://example.com',
  domain: 'example.com',
  tags: [{ tagId: 5, inherit: true }],
});
// лежит в «Папке», тег eris унаследован от неё
const inner = makeEntry({ id: 8, parentId: 3, name: 'внутри.txt', inheritedTags: [{ tagId: 1, fromId: 3 }] });

const rootListing: Listing = { parent: null, path: [], entries: [folder, photo, link] };
const folderListing: Listing = { parent: folder, path: [{ id: 3, name: 'Папка' }], entries: [inner] };

let server: FakeServer;

function installServer(extra: Record<string, Handler> = {}): void {
  server = installFakeServer({
    'GET /api/v1/safe/status': () => ({
      json: {
        unlocked: true,
        authorized: true,
        lastPath: 'C:\\сейф.safebox',
        defaultDirectory: 'C:\\',
        safe: { path: 'C:\\сейф.safebox', entryCount: 4, idleRemainingSec: 900 },
      },
    }),
    'POST /api/v1/safe/heartbeat': () => ({ json: { idleRemainingSec: 900 } }),
    'GET /api/v1/entries': (c) => ({ json: c.query.get('parentId') === '3' ? folderListing : rootListing }),
    'GET /api/v1/entries/3': () => ({ json: folder }),
    'GET /api/v1/folders': () => ({ json: { folders: [{ id: 3, parentId: null, name: 'Папка' }] } }),
    'GET /api/v1/tags': () => ({ json: { categories } }),
    'GET /api/v1/search': (c) => ({
      json: { query: c.query.get('q') ?? '', results: [{ entry: photo, path: [], matchedIn: null }] },
    }),
    'POST /api/v1/entries/tags': () => ({ json: { updated: 2 } }),
    ...extra,
  });
}

const searchCalls = () => server.callsTo('GET', '/api/v1/search');
const lastSearch = () => searchCalls().at(-1)?.query;

async function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MainShell onLocked={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('кот.jpg');
  return userEvent.setup();
}

function cardOf(name: string): HTMLElement {
  const el = screen.getAllByTitle(new RegExp(`^${name}`)).find((e) => e.hasAttribute('draggable'));
  if (el === undefined) throw new Error(`нет карточки «${name}»`);
  return el;
}

/** Открыть панель фильтра справа и выбрать теги по подстроке ввода. */
async function pickFilterTags(user: ReturnType<typeof userEvent.setup>, ...inputs: string[]) {
  const panel =
    screen.queryByRole('complementary', { name: 'Фильтр по тегам' }) ??
    (await (async () => {
      await user.click(screen.getByRole('button', { name: /^Фильтр/ }));
      return screen.findByRole('complementary', { name: 'Фильтр по тегам' });
    })());
  for (const input of inputs) {
    await user.type(within(panel).getByRole('combobox', { name: 'Выбрать тег для фильтра' }), input);
    await user.click(await within(panel).findByRole('option'));
  }
  return panel;
}

beforeEach(() => {
  setToken('t');
  categories = [
    {
      id: 10,
      name: 'character',
      tags: [
        { id: 1, categoryId: 10, name: 'eris greyrat', count: 3 },
        { id: 2, categoryId: 10, name: 'roxy migurdia', count: 1 },
      ],
    },
    { id: 20, name: 'language', tags: [{ id: 5, categoryId: 20, name: 'ru', count: 4 }] },
  ];
  installServer();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('теги на карточках и в панели свойств', () => {
  it('карточки показывают свои теги маленькими чипами', async () => {
    await renderShell();
    expect(await within(cardOf('кот.jpg')).findByTitle(/character: eris greyrat/)).toBeInTheDocument();
    expect(await within(cardOf('Пример')).findByTitle(/language: ru/)).toBeInTheDocument();
  });

  it('«Теги…» в меню карточки открывает панель свойств с фокусом в поле тегов', async () => {
    await renderShell();
    fireEvent.contextMenu(cardOf('кот.jpg'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Теги…' }));
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    const box = within(panel).getByRole('combobox', { name: 'Добавить тег' });
    await waitFor(() => expect(box).toHaveFocus());
    expect(await within(panel).findByRole('button', { name: 'Снять тег «character: eris greyrat»' })).toBeInTheDocument();
  });

  it('унаследованный тег: «от: <папка>» из крошек, клик ведёт к папке-источнику', async () => {
    const user = await renderShell();
    fireEvent.click(cardOf('Папка')); // открыть папку
    await screen.findByText('внутри.txt');
    await user.click(within(cardOf('внутри.txt')).getByRole('checkbox'));
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    const chip = await within(panel).findByTitle('от: Папка');
    expect(within(panel).queryByRole('button', { name: /Снять тег/ })).toBeNull();
    expect(server.callsTo('GET', '/api/v1/entries/3')).toHaveLength(0); // имя уже есть в крошках

    await user.click(chip);
    // переход в родителя источника (корень) и выделение самой папки: панель показывает её
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'Свойства' })).getByLabelText('Имя')).toHaveValue('Папка'));
    expect(server.callsTo('GET', '/api/v1/entries/3')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Путь' })).toHaveTextContent('Все объекты');
    expect(screen.queryByText('внутри.txt')).toBeNull();
  });

  it('панель выделения: «Теги…» добавляет тег всем выделенным', async () => {
    const user = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «Пример»' }));
    const bar = screen.getByRole('toolbar', { name: 'Действия с выделенным' });
    await user.click(within(bar).getByRole('button', { name: 'Теги…' }));
    const popover = await screen.findByRole('group', { name: 'Теги выделенных записей' });
    await user.type(within(popover).getByRole('combobox'), 'roxy');
    await user.click(await screen.findByRole('option', { name: /roxy migurdia/ }));
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/entries/tags')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/entries/tags')[0]?.body).toEqual({
      ids: [1, 2],
      add: [{ tagId: 2, inherit: false }],
    });
  });

  it('клик по чипу тега на карточке: фильтр по нему на весь сейф, панель фильтра открыта', async () => {
    const user = await renderShell();
    await user.click(
      within(cardOf('кот.jpg')).getByRole('button', { name: 'Показать все записи с тегом «character: eris greyrat»' }),
    );
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    expect(lastSearch()?.get('match')).toBe('categories');
    const panel = screen.getByRole('complementary', { name: 'Фильтр по тегам' });
    expect(within(panel).getByRole('list', { name: 'Выбранные теги' })).toHaveTextContent('character: eris greyrat');
    expect(await screen.findByText(/Фильтр: character: eris greyrat/)).toBeInTheDocument();
  });

  it('клик по тегу в панели свойств - тот же фильтр', async () => {
    const user = await renderShell();
    fireEvent.contextMenu(cardOf('кот.jpg'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Теги…' }));
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    await user.click(within(panel).getByRole('button', { name: 'character: eris greyrat' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    expect(screen.getByRole('complementary', { name: 'Фильтр по тегам' })).toBeInTheDocument();
  });
});

describe('фильтр по тегам (UF-18)', () => {
  it('выбор тегов: GET /search?q=&tags=…&match=categories, крошка «Фильтр: …»', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris', 'roxy', 'language:ru');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,2,5'));
    const q = lastSearch();
    expect(q?.get('q')).toBe('');
    expect(q?.get('match')).toBe('categories');
    expect(q?.has('within')).toBe(false);
    expect(await screen.findByText(/Фильтр: character: eris greyrat, character: roxy migurdia, language: ru/)).toBeInTheDocument();
    // тот же вид, что у поиска: путь заменён крошкой, дерево не подсвечено
    expect(screen.queryByRole('navigation', { name: 'Путь' })).toBeNull();
  });

  it('режим сочетания: «Все И» и «Все ИЛИ» меняют match', async () => {
    const user = await renderShell();
    const dialog = await pickFilterTags(user, 'eris');
    await user.click(within(dialog).getByRole('radio', { name: 'Все И' }));
    await waitFor(() => expect(lastSearch()?.get('match')).toBe('all'));
    await user.click(within(dialog).getByRole('radio', { name: 'Все ИЛИ' }));
    await waitFor(() => expect(lastSearch()?.get('match')).toBe('any'));
  });

  it('«В этой папке»: within = id открытой папки', async () => {
    const user = await renderShell();
    fireEvent.click(cardOf('Папка'));
    await screen.findByText('внутри.txt');
    const dialog = await pickFilterTags(user, 'eris');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(0));
    expect(lastSearch()?.has('within')).toBe(false); // по умолчанию - весь сейф
    await user.click(within(dialog).getByRole('radio', { name: 'В этой папке' }));
    await waitFor(() => expect(lastSearch()?.get('within')).toBe('3'));
    expect(await screen.findByText(/Фильтр: character: eris greyrat · в этой папке/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Весь сейф' }));
    await waitFor(() => expect(lastSearch()?.has('within')).toBe(false));
  });

  it('фильтр сочетается с поиском по имени: q и tags в одном запросе, «Поиск: …» рядом', async () => {
    server.routes['GET /api/v1/search'] = (c) => ({
      json: {
        query: c.query.get('q') ?? '',
        results: [{ entry: photo, path: [], matchedIn: 'description' }],
      },
    });
    const user = await renderShell();
    await pickFilterTags(user, 'eris');
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('Поиск по именам во всём сейфе'), 'кот');
    await waitFor(() => expect(lastSearch()?.get('q')).toBe('кот'));
    expect(lastSearch()?.get('tags')).toBe('1');
    expect(screen.getByText(/Фильтр: character: eris greyrat/)).toBeInTheDocument();
    expect(screen.getByText(/Поиск: «кот»/)).toBeInTheDocument();
    expect(await screen.findByText('в описании')).toBeInTheDocument();
  });

  it('крестик в крошке сбрасывает фильтр и возвращает в папку', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris');
    await screen.findByText(/Фильтр: character: eris greyrat/);
    await user.keyboard('{Escape}'); // закрыть поповер: в нём своя кнопка «Сбросить фильтр»
    await user.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    expect(screen.queryByText(/Фильтр: /)).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Путь' })).toBeInTheDocument();
    expect(screen.getByText('Пример')).toBeInTheDocument();
  });

  it('клик по папке сбрасывает фильтр', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris');
    await screen.findByText(/Фильтр: character: eris greyrat/);
    const tree = screen.getByRole('navigation', { name: 'Папки' });
    await user.click(await within(tree).findByRole('button', { name: /Папка/ }));
    expect(screen.queryByText(/Фильтр: /)).toBeNull();
    expect(await screen.findByText('внутри.txt')).toBeInTheDocument();
  });

  it('клик по результату-папке - переход в неё, фильтр сброшен (как у поиска)', async () => {
    server.routes['GET /api/v1/search'] = () => ({
      json: { query: '', results: [{ entry: folder, path: [], matchedIn: null }] },
    });
    const user = await renderShell();
    await pickFilterTags(user, 'eris');
    await screen.findByText(/Фильтр: /);
    fireEvent.click(cardOf('Папка'));
    expect(await screen.findByText('внутри.txt')).toBeInTheDocument();
    expect(screen.queryByText(/Фильтр: /)).toBeNull();
  });

  it('Esc сбрасывает фильтр, как поиск', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris');
    await screen.findByText(/Фильтр: /);
    await user.keyboard('{Escape}'); // закрыл панель фильтра
    await user.keyboard('{Escape}'); // сбросил фильтр
    expect(screen.queryByText(/Фильтр: /)).toBeNull();
  });

  it('тег исчез из каталога (удалили) - уходит и из фильтра, запрос без него', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris', 'language:ru');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,5'));
    await user.keyboard('{Escape}');
    categories = categories.map((c) => (c.id === 20 ? { ...c, tags: [] } : c));
    // экран «Теги» при открытии перечитывает каталог - как после удаления тега в нём
    await user.click(screen.getByRole('button', { name: /Теги$/ }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    expect(await screen.findByText(/Фильтр: character: eris greyrat$/)).toBeInTheDocument();
  });
});

describe('каталог тегов в левой колонке', () => {
  function sidebar(): HTMLElement {
    return screen.getByRole('region', { name: 'Каталог тегов' });
  }

  it('категории и теги со счётчиками видны под деревом папок', async () => {
    await renderShell();
    expect(await within(sidebar()).findByRole('button', { name: 'eris greyrat 3' })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('button', { name: 'ru 4' })).toBeInTheDocument();
    expect(within(sidebar()).getByText('character')).toBeInTheDocument();
    expect(within(sidebar()).getByText('language')).toBeInTheDocument();
  });

  it('клик по тегу включает фильтр и открывает панель справа, второй тег добавляется', async () => {
    const user = await renderShell();
    await user.click(await within(sidebar()).findByRole('button', { name: 'eris greyrat 3' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    const panel = screen.getByRole('complementary', { name: 'Фильтр по тегам' });
    expect(within(panel).getByRole('list', { name: 'Выбранные теги' })).toHaveTextContent('character: eris greyrat');
    await user.click(within(sidebar()).getByRole('button', { name: 'ru 4' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,5'));
  });

  it('повторный клик по выбранному тегу убирает его из фильтра', async () => {
    const user = await renderShell();
    await user.click(await within(sidebar()).findByRole('button', { name: 'eris greyrat 3' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await user.click(within(sidebar()).getByRole('button', { name: 'eris greyrat 3' }));
    // фильтр опустел - галерея вернулась к обычному виду папки
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Путь' })).toBeInTheDocument());
    expect(screen.queryByText(/Фильтр: /)).toBeNull();
  });

  it('⚙ открывает экран управления тегами', async () => {
    const user = await renderShell();
    await user.click(await within(sidebar()).findByRole('button', { name: 'Управление тегами' }));
    expect(await screen.findByRole('region', { name: 'Управление тегами' })).toBeInTheDocument();
  });
});

describe('теги в просмотрщике (фото на весь экран)', () => {
  const dog = makeEntry({ id: 6, kind: 'photo', name: 'пёс.jpg', tags: [{ tagId: 5, inherit: false }] });

  async function openViewer(): Promise<ReturnType<typeof userEvent.setup>> {
    server.routes['GET /api/v1/entries'] = () => ({
      json: { ...rootListing, entries: [folder, photo, dog, link] },
    });
    const user = await renderShell();
    fireEvent.click(cardOf('кот.jpg'));
    await screen.findByRole('dialog', { name: 'Просмотр фото' });
    return user;
  }

  it('панель слева открывается вместе с фото: теги записи, поле добавления, описание', async () => {
    await openViewer();
    const panel = screen.getByRole('complementary', { name: 'Теги записи' });
    expect(within(panel).getByRole('combobox', { name: 'Добавить тег' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Снять тег «character: eris greyrat»' })).toBeInTheDocument();
    expect(within(panel).getByLabelText('Описание')).toBeInTheDocument();
  });

  it('тег добавляется прямо из просмотрщика', async () => {
    const user = await openViewer();
    const panel = screen.getByRole('complementary', { name: 'Теги записи' });
    await user.type(within(panel).getByRole('combobox', { name: 'Добавить тег' }), 'language:ru{Enter}');
    await waitFor(() => expect(server.callsTo('POST', '/api/v1/entries/tags')).toHaveLength(1));
    expect(server.callsTo('POST', '/api/v1/entries/tags')[0]?.body).toEqual({
      ids: [1],
      add: [{ tagId: 5, inherit: false }],
    });
  });

  it('описание правится не выходя из просмотра', async () => {
    server.routes['PATCH /api/v1/entries/1'] = () => ({ json: photo });
    const user = await openViewer();
    const field = within(screen.getByRole('complementary', { name: 'Теги записи' })).getByLabelText('Описание');
    await user.type(field, 'Рыжий');
    await user.tab();
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/entries/1')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/entries/1')[0]?.body).toEqual({ description: 'Рыжий' });
  });

  it('✕ прячет панель, 🏷 возвращает; просмотрщик при этом не закрывается', async () => {
    const user = await openViewer();
    await user.click(screen.getByRole('button', { name: 'Скрыть панель тегов' }));
    expect(screen.queryByRole('complementary', { name: 'Теги записи' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Показать панель тегов' }));
    expect(screen.getByRole('complementary', { name: 'Теги записи' })).toBeInTheDocument();
  });

  it('стрелки листают фото - панель показывает теги следующего', async () => {
    const user = await openViewer();
    await user.click(screen.getByRole('button', { name: 'Следующее фото (→)' }));
    const panel = screen.getByRole('complementary', { name: 'Теги записи' });
    expect(await within(panel).findByRole('button', { name: 'Снять тег «language: ru»' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Снять тег «character: eris greyrat»' })).toBeNull();
  });

  it('Esc в поле тегов закрывает подсказки, но не просмотрщик', async () => {
    const user = await openViewer();
    const panel = screen.getByRole('complementary', { name: 'Теги записи' });
    await user.click(within(panel).getByRole('combobox', { name: 'Добавить тег' }));
    await within(panel).findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
  });
});

describe('экран «Теги» (UF-17)', () => {
  it('кнопка в верхней панели открывает экран, «Назад» возвращает к галерее', async () => {
    const user = await renderShell();
    await user.click(screen.getByRole('button', { name: /Теги$/ }));
    const screenRegion = await screen.findByRole('region', { name: 'Управление тегами' });
    expect(within(screenRegion).getByRole('region', { name: 'Категория character' })).toBeInTheDocument();
    await user.click(within(screenRegion).getByRole('button', { name: /Назад/ }));
    expect(screen.queryByRole('region', { name: 'Управление тегами' })).toBeNull();
    expect(screen.getByText('кот.jpg')).toBeInTheDocument();
  });

  it('пока экран открыт, горячие клавиши галереи молчат, Esc закрывает экран', async () => {
    const user = await renderShell();
    await user.click(within(cardOf('кот.jpg')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Теги$/ }));
    await screen.findByRole('region', { name: 'Управление тегами' });
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('dialog')).toBeNull(); // подтверждения удаления нет
    expect(screen.queryByRole('toolbar', { name: 'Действия с выделенным' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Управление тегами' })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Действия с выделенным' })).toBeInTheDocument(); // выделение уцелело
  });

  it('клик по тегу: экран закрывается, открыт фильтр по этому тегу на весь сейф', async () => {
    const user = await renderShell();
    await user.click(screen.getByRole('button', { name: /Теги$/ }));
    await user.click(await screen.findByRole('button', { name: 'Показать записи с тегом «language: ru»' }));
    expect(screen.queryByRole('region', { name: 'Управление тегами' })).toBeNull();
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('5'));
    expect(lastSearch()?.get('match')).toBe('categories');
    expect(await screen.findByText(/Фильтр: language: ru/)).toBeInTheDocument();
  });
});
