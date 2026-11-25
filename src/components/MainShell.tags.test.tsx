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

const tagsPanel = () => screen.getByRole('region', { name: 'Каталог тегов' });
const filterBar = () => screen.getByRole('region', { name: 'Фильтр по тегам' });
/** Что выбрано - текстом строки фильтра над галереей. */
const filterText = () => within(filterBar()).getByRole('list', { name: 'Выбранные теги' }).textContent;

/** Отметить теги галочками в панели «Теги» (по имени тега). */
async function pickFilterTags(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) {
    await user.click(await within(tagsPanel()).findByRole('checkbox', { name }));
  }
  return filterBar();
}

beforeEach(() => {
  setToken('t');
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
    fireEvent.doubleClick(cardOf('Папка')); // открыть папку
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

  it('клик по чипу тега на карточке: фильтр по нему на весь сейф, он в строке фильтра и отмечен в панели', async () => {
    const user = await renderShell();
    await user.click(
      within(cardOf('кот.jpg')).getByRole('button', { name: 'Показать все записи с тегом «character: eris greyrat»' }),
    );
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    expect(lastSearch()?.get('match')).toBe('categories');
    expect(filterText()).toContain('eris greyrat');
    expect(within(tagsPanel()).getByRole('checkbox', { name: 'eris greyrat' })).toBeChecked();
  });

  it('клик по тегу в панели свойств - тот же фильтр', async () => {
    const user = await renderShell();
    fireEvent.contextMenu(cardOf('кот.jpg'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Теги…' }));
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    await user.click(within(panel).getByRole('button', { name: 'character: eris greyrat' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    expect(filterBar()).toBeInTheDocument();
  });
});

describe('фильтр по тегам (UF-18)', () => {
  it('галочки в панели «Теги»: GET /search?q=&tags=…&match=categories, строка фильтра фразой', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat', 'roxy migurdia', 'ru');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,2,5'));
    const q = lastSearch();
    expect(q?.get('q')).toBe('');
    expect(q?.get('match')).toBe('categories');
    expect(q?.has('within')).toBe(false);
    expect(filterText()).toBe('character:eris greyrat✕илиroxy migurdia✕иlanguage:ru✕');
    // тот же вид, что у поиска: пути нет, теги в шапке не повторяются
    expect(screen.queryByRole('navigation', { name: 'Путь' })).toBeNull();
    expect(within(screen.getByRole('banner')).queryByText(/eris/)).toBeNull();
    expect(within(tagsPanel()).getByLabelText('Выбрано тегов: 3')).toBeInTheDocument();
  });

  it('снятая галочка убирает тег; последняя - галерея возвращается к папке', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat', 'ru');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,5'));
    await user.click(within(tagsPanel()).getByRole('checkbox', { name: 'ru' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await user.click(within(tagsPanel()).getByRole('checkbox', { name: 'eris greyrat' }));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Путь' })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Фильтр по тегам' })).toBeNull();
  });

  it('режим сочетания: «Все теги сразу» и «Любой из тегов» меняют match', async () => {
    const user = await renderShell();
    const bar = await pickFilterTags(user, 'eris greyrat');
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Сочетание тегов' }), 'all');
    await waitFor(() => expect(lastSearch()?.get('match')).toBe('all'));
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Сочетание тегов' }), 'any');
    await waitFor(() => expect(lastSearch()?.get('match')).toBe('any'));
  });

  it('область «В «папка»»: within = id открытой папки', async () => {
    const user = await renderShell();
    fireEvent.doubleClick(cardOf('Папка'));
    await screen.findByText('внутри.txt');
    const bar = await pickFilterTags(user, 'eris greyrat');
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(0));
    expect(lastSearch()?.has('within')).toBe(false); // по умолчанию - весь сейф
    await user.click(await within(bar).findByRole('radio', { name: 'В «Папка»' }));
    await waitFor(() => expect(lastSearch()?.get('within')).toBe('3'));
    await user.click(within(bar).getByRole('radio', { name: 'Весь сейф' }));
    await waitFor(() => expect(lastSearch()?.has('within')).toBe(false));
  });

  it('фильтр сочетается с поиском по имени: q и tags в одном запросе, «Поиск: …» в шапке', async () => {
    server.routes['GET /api/v1/search'] = (c) => ({
      json: {
        query: c.query.get('q') ?? '',
        results: [{ entry: photo, path: [], matchedIn: 'description' }],
      },
    });
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat');
    await user.type(screen.getByLabelText('Поиск по именам во всём сейфе'), 'кот');
    await waitFor(() => expect(lastSearch()?.get('q')).toBe('кот'));
    expect(lastSearch()?.get('tags')).toBe('1');
    expect(filterText()).toContain('eris greyrat');
    expect(screen.getByText(/Поиск: «кот»/)).toBeInTheDocument();
    expect(await screen.findByText('в описании')).toBeInTheDocument();
  });

  it('«Сбросить» в строке фильтра возвращает в папку', async () => {
    const user = await renderShell();
    const bar = await pickFilterTags(user, 'eris greyrat');
    await user.click(within(bar).getByRole('button', { name: 'Сбросить' }));
    expect(screen.queryByRole('region', { name: 'Фильтр по тегам' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Путь' })).toBeInTheDocument();
    expect(screen.getByText('Пример')).toBeInTheDocument();
    expect(within(tagsPanel()).getByRole('checkbox', { name: 'eris greyrat' })).not.toBeChecked();
  });

  it('папка в дереве при фильтре сужает его до неё, теги остаются; корень - снова весь сейф', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    const tree = screen.getByRole('navigation', { name: 'Папки' });
    await user.click(await within(tree).findByRole('button', { name: /Папка/ }));
    await waitFor(() => expect(lastSearch()?.get('within')).toBe('3'));
    expect(lastSearch()?.get('tags')).toBe('1');
    expect(within(filterBar()).getByRole('radio', { name: 'В «Папка»' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(tree).getByRole('button', { name: /Все объекты/ }));
    await waitFor(() => expect(lastSearch()?.has('within')).toBe(false));
    expect(filterText()).toContain('eris greyrat');
  });

  it('клик по результату-папке - переход в неё, фильтр сброшен (как у поиска)', async () => {
    server.routes['GET /api/v1/search'] = () => ({
      json: { query: '', results: [{ entry: folder, path: [], matchedIn: null }] },
    });
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await waitFor(() => expect(screen.queryByText('кот.jpg')).toBeNull());
    fireEvent.doubleClick(cardOf('Папка'));
    expect(await screen.findByText('внутри.txt')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Фильтр по тегам' })).toBeNull();
  });

  it('Esc сбрасывает фильтр, как поиск - и сразу после щелчка по галочке', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat');
    expect(within(tagsPanel()).getByRole('checkbox', { name: 'eris greyrat' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Фильтр по тегам' })).toBeNull();
  });

  it('тег исчез из каталога (удалили) - уходит и из фильтра, запрос без него', async () => {
    const user = await renderShell();
    await pickFilterTags(user, 'eris greyrat', 'ru');
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1,5'));
    categories = categories.map((c) => (c.id === 20 ? { ...c, tags: [] } : c));
    // экран «Теги» при открытии перечитывает каталог - как после удаления тега в нём
    await user.click(within(tagsPanel()).getByRole('button', { name: 'Управление тегами' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    await waitFor(() => expect(filterText()).toBe('character:eris greyrat✕'));
  });
});

describe('панель «Теги»', () => {
  it('категории и теги со счётчиками видны рядом с деревом папок', async () => {
    await renderShell();
    const eris = await within(tagsPanel()).findByRole('checkbox', { name: 'eris greyrat' });
    expect(eris.closest('label')).toHaveTextContent('eris greyrat3');
    expect(within(tagsPanel()).getByRole('checkbox', { name: 'ru' })).toBeInTheDocument();
    expect(within(tagsPanel()).getByText('character')).toBeInTheDocument();
    expect(within(tagsPanel()).getByText('language')).toBeInTheDocument();
  });

  it('⚙ открывает экран управления тегами', async () => {
    const user = await renderShell();
    await user.click(await within(tagsPanel()).findByRole('button', { name: 'Управление тегами' }));
    expect(await screen.findByRole('region', { name: 'Управление тегами' })).toBeInTheDocument();
  });
});

describe('раскладка панелей', () => {
  beforeEach(() => localStorage.removeItem('sbx_panels'));
  const left = () => document.querySelector('[data-dock="left"]');
  const right = () => document.querySelector('[data-dock="right"]');

  it('по умолчанию папки и теги друг под другом слева; меню ⋯ ставит теги справа и запоминает', async () => {
    const user = await renderShell();
    expect(left()?.querySelectorAll('[data-panel]')).toHaveLength(2);
    expect(right()).toBeNull();

    await user.click(within(tagsPanel()).getByRole('button', { name: 'Расположение панелей' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Папки слева, теги справа/ }));
    expect(right()?.querySelector('[data-panel="tags"]')).not.toBeNull();
    expect(left()?.querySelector('[data-panel="tags"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('sbx_panels')!).layout.right.items).toEqual(['tags']);
  });

  it('панель в стопке сворачивается до заголовка', async () => {
    const user = await renderShell();
    await within(tagsPanel()).findByRole('checkbox', { name: 'ru' });
    await user.click(screen.getByRole('button', { name: 'Панель «Теги»' }));
    expect(within(tagsPanel()).queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Панель «Теги»' }));
    expect(within(tagsPanel()).getByRole('checkbox', { name: 'ru' })).toBeInTheDocument();
  });

  it('ширина панели меняется стрелками на границе', async () => {
    const user = await renderShell();
    const sep = screen.getByRole('separator', { name: 'Ширина боковой панели' });
    sep.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(sep).toHaveAttribute('aria-valuenow', '292');
    expect((left() as HTMLElement).style.width).toBe('292px');
  });
});

// Язык имён тегов: RU/EN в шапке панели «Теги» пишет ту же настройку, что «Настройки»;
// карточки, каталог, строка фильтра и подсказки показывают имена на выбранном языке.
describe('язык тегов (RU/EN)', () => {
  let tagLanguage: 'ru' | 'en';
  const sidebar = tagsPanel;
  const langSwitch = () => within(sidebar()).getByRole('radiogroup', { name: 'Язык тегов' });

  beforeEach(() => {
    tagLanguage = 'ru';
    // второе имя есть у категории character и у тега eris greyrat; у roxy и language - нет
    categories = categories.map((c) =>
      c.id === 10
        ? { ...c, nameEn: 'Characters', tags: c.tags.map((t) => (t.id === 1 ? { ...t, nameEn: 'Erisu' } : t)) }
        : c,
    );
    server.routes['GET /api/v1/settings'] = () => ({ json: { linkPreviews: true, tagLanguage } });
    server.routes['PATCH /api/v1/settings'] = (c) => {
      tagLanguage = (c.body as { tagLanguage: 'ru' | 'en' }).tagLanguage;
      return { json: { linkPreviews: true, tagLanguage } };
    };
  });

  it('по умолчанию основные имена; EN переключает каталог, карточки и строку фильтра, PATCH - { tagLanguage }', async () => {
    const user = await renderShell();
    expect(await within(sidebar()).findByRole('checkbox', { name: 'eris greyrat' })).toBeInTheDocument();
    expect(within(langSwitch()).getByRole('radio', { name: 'RU' })).toBeChecked();

    await user.click(within(langSwitch()).getByRole('radio', { name: 'EN' }));
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/settings')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/settings')[0]?.body).toEqual({ tagLanguage: 'en' });

    // у eris greyrat - второе имя, у roxy migurdia и language нет - остаются основные
    expect(await within(sidebar()).findByRole('checkbox', { name: 'Erisu' })).toBeInTheDocument();
    expect(within(sidebar()).getByText('Characters')).toBeInTheDocument();
    expect(within(sidebar()).getByRole('checkbox', { name: 'roxy migurdia' })).toBeInTheDocument();
    expect(within(sidebar()).getByText('language')).toBeInTheDocument();
    expect(within(cardOf('кот.jpg')).getByTitle(/Characters: Erisu/)).toBeInTheDocument();

    // клик по чипу: фильтр по id, строка фильтра - на языке тегов
    await user.click(within(cardOf('кот.jpg')).getByRole('button', { name: 'Показать все записи с тегом «Characters: Erisu»' }));
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('1'));
    await waitFor(() => expect(filterText()).toBe('Characters:Erisu✕'));

    // обратно на RU: тот же фильтр, подписи основные
    await user.click(within(langSwitch()).getByRole('radio', { name: 'RU' }));
    await waitFor(() => expect(filterText()).toBe('character:eris greyrat✕'));
    expect(lastSearch()?.get('tags')).toBe('1');
    expect(server.callsTo('PATCH', '/api/v1/settings').map((c) => c.body)).toEqual([
      { tagLanguage: 'en' },
      { tagLanguage: 'ru' },
    ]);
  });

  it('язык с сервера (en) применяется сразу при открытии сейфа', async () => {
    tagLanguage = 'en';
    await renderShell();
    expect(await within(sidebar()).findByRole('checkbox', { name: 'Erisu' })).toBeInTheDocument();
    expect(within(langSwitch()).getByRole('radio', { name: 'EN' })).toBeChecked();
    expect(await within(cardOf('кот.jpg')).findByTitle(/Characters: Erisu/)).toBeInTheDocument();
  });

  it('подсказки ищут по второму имени при любом языке: «erisu» находит «eris greyrat»', async () => {
    const user = await renderShell();
    const bar = await pickFilterTags(user, 'ru');
    await user.click(within(bar).getByRole('button', { name: '+ тег' }));
    await user.type(within(bar).getByRole('combobox', { name: 'Добавить тег в фильтр' }), 'erisu');
    expect(await within(bar).findByRole('option', { name: /character: eris greyrat/ })).toBeInTheDocument();
  });
});

describe('теги в просмотрщике (фото на весь экран)', () => {
  const dog = makeEntry({ id: 6, kind: 'photo', name: 'пёс.jpg', tags: [{ tagId: 5, inherit: false }] });

  async function openViewer(): Promise<ReturnType<typeof userEvent.setup>> {
    server.routes['GET /api/v1/entries'] = () => ({
      json: { ...rootListing, entries: [folder, photo, dog, link] },
    });
    const user = await renderShell();
    fireEvent.doubleClick(cardOf('кот.jpg'));
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
    await user.click(screen.getByRole('button', { name: 'Следующее (→)' }));
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
  it('⚙ в панели «Теги» открывает экран, «Назад» возвращает к галерее', async () => {
    const user = await renderShell();
    await user.click(within(tagsPanel()).getByRole('button', { name: 'Управление тегами' }));
    const screenRegion = await screen.findByRole('region', { name: 'Управление тегами' });
    expect(within(screenRegion).getByRole('region', { name: 'Категория character' })).toBeInTheDocument();
    await user.click(within(screenRegion).getByRole('button', { name: /Назад/ }));
    expect(screen.queryByRole('region', { name: 'Управление тегами' })).toBeNull();
    expect(screen.getByText('кот.jpg')).toBeInTheDocument();
  });

  it('пока экран открыт, горячие клавиши галереи молчат, Esc закрывает экран', async () => {
    const user = await renderShell();
    await user.click(within(cardOf('кот.jpg')).getByRole('checkbox'));
    await user.click(within(tagsPanel()).getByRole('button', { name: 'Управление тегами' }));
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
    await user.click(within(tagsPanel()).getByRole('button', { name: 'Управление тегами' }));
    await user.click(await screen.findByRole('button', { name: 'Показать записи с тегом «language: ru»' }));
    expect(screen.queryByRole('region', { name: 'Управление тегами' })).toBeNull();
    await waitFor(() => expect(lastSearch()?.get('tags')).toBe('5'));
    expect(lastSearch()?.get('match')).toBe('categories');
    await waitFor(() => expect(filterText()).toBe('language:ru✕'));
  });
});
