import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setToken } from '../api/client';
import type { CreateLinksResponse, Entry, Listing, NewLink } from '../api/types';
import { DRAG_MIME } from '../lib/move';
import chromeExport from '../lib/fixtures/chrome-bookmarks.html?raw';
import { makeEntry } from '../test/factories';
import { installFakeServer } from '../test/fakeServer';
import type { FakeServer, Handler } from '../test/fakeServer';
import { MainShell } from './MainShell';
import { ToastProvider } from './Toasts';

// Ссылки в главном окне на подставном сервере (UF-20, UF-21, UF-6, UF-19): Ctrl+V,
// перетаскивание, поле «Ссылка», «Уже есть», закладки, опрос предпросмотра, настройки.

const mocks = vi.hoisted(() => ({ importEntries: vi.fn() }));

vi.mock('../api/endpoints', async (original) => ({
  ...(await original<typeof import('../api/endpoints')>()),
  importEntries: mocks.importEntries,
}));

const folder = makeEntry({ id: 3, kind: 'folder', name: 'Папка', childCount: 1 });
const photo = makeEntry({ id: 1, kind: 'photo', name: 'кот.jpg', childCount: 1 });
const link = makeEntry({
  id: 2,
  kind: 'link',
  name: 'Пример',
  url: 'https://example.com',
  domain: 'example.com',
  hasThumbnail: true,
});
const dup = makeEntry({ id: 9, parentId: 3, kind: 'link', name: 'Уже тут', url: 'https://dup.com/', domain: 'dup.com' });

let rootEntries: Entry[];
let server: FakeServer;
let nextId: number;

const hostOf = (url: string) => new URL(url).hostname;

/** Ответ сервера по умолчанию: все адреса новые, каждому - запись с именем-доменом. */
function createdAll(links: NewLink[]): CreateLinksResponse {
  const created = links.map((l) =>
    makeEntry({
      id: (nextId += 1),
      kind: 'link',
      name: l.name ?? hostOf(l.url),
      url: l.url,
      domain: hostOf(l.url),
    }),
  );
  rootEntries.push(...created);
  return { created, existing: [], invalid: [] };
}

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
    'GET /api/v1/entries': (c): { json: Listing } => {
      const parent = c.query.get('parentId');
      if (parent === '3') return { json: { parent: folder, path: [{ id: 3, name: 'Папка' }], entries: [dup] } };
      if (parent === '1') return { json: { parent: photo, path: [{ id: 1, name: 'кот.jpg' }], entries: [] } };
      return { json: { parent: null, path: [], entries: rootEntries } };
    },
    'GET /api/v1/entries/9': () => ({ json: dup }),
    'GET /api/v1/folders': () => ({ json: { folders: [{ id: 3, parentId: null, name: 'Папка' }] } }),
    'GET /api/v1/tags': () => ({ json: { categories: [] } }),
    'POST /api/v1/import/plan': () => ({ json: { conflicts: [], newFiles: 1 } }),
    'POST /api/v1/links': (c) => ({ status: 201, json: createdAll((c.body as { links: NewLink[] }).links) }),
    ...extra,
  });
}

const linkPosts = () => server.callsTo('POST', '/api/v1/links');
const entryGets = () => server.callsTo('GET', '/api/v1/entries');

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

/** Корень карточки (у неё title и draggable) по имени записи. */
function cardOf(name: string): HTMLElement {
  const el = screen.getAllByTitle(new RegExp(`^${name}`)).find((e) => e.hasAttribute('draggable'));
  if (el === undefined) throw new Error(`нет карточки «${name}»`);
  return el;
}

/** Ctrl+V вне полей ввода; false - обработчик забрал вставку (preventDefault). */
function paste(text: string, files: File[] = [], target: Element = document.body): boolean {
  return fireEvent.paste(target, { clipboardData: { files, getData: () => text } });
}

interface FakeTransfer {
  types: string[];
  files: File[];
  getData: (type: string) => string;
  dropEffect: string;
}

function transfer(data: Record<string, string>, extraTypes: string[] = [], files: File[] = []): FakeTransfer {
  return {
    types: [...Object.keys(data), ...extraTypes],
    files,
    getData: (type) => data[type] ?? '',
    dropEffect: '',
  };
}

const linkTransfer = (url: string) => transfer({ 'text/uri-list': `${url}\r\n`, 'text/plain': url });

beforeEach(() => {
  setToken('t');
  rootEntries = [folder, photo, link];
  nextId = 100;
  mocks.importEntries.mockReset();
  installServer();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setToken(null);
});

describe('Ctrl+V: адреса из буфера (UF-20)', () => {
  it('несколько адресов - один запрос POST /links в открытую папку', async () => {
    await renderShell();
    expect(paste('https://a.com/x\nhttps://b.org/\r\nhttps://c.net/y?z=1')).toBe(false);
    expect(await screen.findByText('Добавлено ссылок: 3')).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(1);
    expect(linkPosts()[0]?.body).toEqual({
      parentId: null,
      links: [{ url: 'https://a.com/x' }, { url: 'https://b.org/' }, { url: 'https://c.net/y?z=1' }],
    });
  });

  it('пустые строки и пробелы не мешают; некорректная строка - отдельный тост', async () => {
    await renderShell();
    paste('\n  https://a.com/  \n\n   \nпросто заметка\n');
    expect(await screen.findByText('Ссылка добавлена')).toBeInTheDocument();
    expect(await screen.findByText('Пропущено некорректных: 1')).toBeInTheDocument();
    expect(linkPosts()[0]?.body).toEqual({ parentId: null, links: [{ url: 'https://a.com/' }] });
  });

  it('всё некорректное - «Это не ссылка», запроса нет', async () => {
    await renderShell();
    paste('привет\nftp://x.org/file');
    expect(await screen.findByText('Это не ссылка')).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(0);
  });

  it('пустой буфер - ничего не происходит, вставка не перехватывается', async () => {
    await renderShell();
    expect(paste('  \n ')).toBe(true);
    expect(linkPosts()).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('в поле ввода вставка обычная', async () => {
    await renderShell();
    const search = screen.getByLabelText('Поиск по именам во всём сейфе');
    expect(paste('https://a.com/', [], search)).toBe(true);
    expect(linkPosts()).toHaveLength(0);
  });

  it('в открытых вложениях записи - parentId записи', async () => {
    await renderShell();
    fireEvent.contextMenu(cardOf('кот.jpg'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Открыть вложения/ }));
    await waitFor(() => expect(entryGets().some((c) => c.query.get('parentId') === '1')).toBe(true));
    paste('https://a.com/');
    await screen.findByText('Ссылка добавлена');
    expect(linkPosts()[0]?.body).toEqual({ parentId: 1, links: [{ url: 'https://a.com/' }] });
  });

  it('новая ссылка появляется в списке и подсвечена', async () => {
    await renderShell();
    paste('https://fresh.example/');
    const card = await waitFor(() => cardOf('fresh.example'));
    expect(card.className).toContain('border-emerald-600');
    expect(cardOf('Пример').className).not.toContain('border-emerald-600');
  });

  it('картинка из буфера по-прежнему импортируется как файл, ссылок не создаёт', async () => {
    mocks.importEntries.mockResolvedValue({ imported: 1, replaced: 0, skipped: 0, failed: 0, failures: [] });
    await renderShell();
    const image = new File(['png'], 'image.png', { type: 'image/png' });
    expect(paste('https://a.com/', [image])).toBe(false);
    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalled());
    expect(linkPosts()).toHaveLength(0);
  });

  it('ответ сервера: повторы и некорректные учитываются в тостах', async () => {
    server.routes['POST /api/v1/links'] = () => ({
      status: 201,
      json: { created: [], existing: [{ url: 'https://a.com/', entryId: 2 }], invalid: ['https://a.com/bad'] },
    });
    await renderShell();
    paste('https://a.com/\nhttps://a.com/bad');
    expect(await screen.findByText('Уже есть')).toBeInTheDocument();
    expect(await screen.findByText('Пропущено некорректных: 1')).toBeInTheDocument();
  });
});

describe('поле «Ссылка» (UF-20)', () => {
  it('адрес + Enter: ссылка создана, поле очищено, окон нет', async () => {
    const user = await renderShell();
    const field = screen.getByLabelText('Ссылка');
    await user.type(field, 'https://example.org/page{Enter}');
    expect(await screen.findByText('Ссылка добавлена')).toBeInTheDocument();
    expect(linkPosts()[0]?.body).toEqual({ parentId: null, links: [{ url: 'https://example.org/page' }] });
    expect(field).toHaveValue('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('не ссылка - «Это не ссылка», текст остаётся для правки, запроса нет', async () => {
    const user = await renderShell();
    const field = screen.getByLabelText('Ссылка');
    await user.type(field, 'example.org{Enter}');
    expect(await screen.findByText('Это не ссылка')).toBeInTheDocument();
    expect(field).toHaveValue('example.org');
    expect(linkPosts()).toHaveLength(0);
  });
});

describe('«Уже есть» (UF-20)', () => {
  it('тост с кнопкой «Показать»: открывает папку и выделяет запись', async () => {
    server.routes['POST /api/v1/links'] = () => ({
      status: 201,
      json: { created: [], existing: [{ url: 'https://dup.com/', entryId: 9 }], invalid: [] },
    });
    const user = await renderShell();
    paste('https://dup.com/');
    expect(await screen.findByText('Уже есть')).toBeInTheDocument();
    expect(linkPosts()[0]?.body).toEqual({ parentId: null, links: [{ url: 'https://dup.com/' }] });

    await user.click(screen.getByRole('button', { name: 'Показать' }));
    await waitFor(() => expect(entryGets().some((c) => c.query.get('parentId') === '3')).toBe(true));
    const box = await screen.findByRole('checkbox', { name: 'Выбрать «Уже тут»' });
    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull(); // тост закрыт нажатием
  });
});

describe('перетаскивание ссылки из браузера (UF-20)', () => {
  const rootOf = () => screen.getByRole('main');

  it('в окно: ссылка в открытую папку', async () => {
    await renderShell();
    fireEvent.drop(rootOf(), { dataTransfer: linkTransfer('https://drag.example/a') });
    expect(await screen.findByText('Ссылка добавлена')).toBeInTheDocument();
    expect(linkPosts()[0]?.body).toEqual({ parentId: null, links: [{ url: 'https://drag.example/a' }] });
  });

  it('строки-комментарии uri-list пропускаются, text/plain - запасной вариант', async () => {
    await renderShell();
    fireEvent.drop(rootOf(), {
      dataTransfer: transfer({ 'text/uri-list': '# из адресной строки\r\nhttps://one.example/\r\n' }),
    });
    await screen.findByText('Ссылка добавлена');
    expect(linkPosts()[0]?.body).toEqual({ parentId: null, links: [{ url: 'https://one.example/' }] });

    fireEvent.drop(rootOf(), { dataTransfer: transfer({ 'text/plain': 'https://two.example/' }) });
    await waitFor(() => expect(linkPosts()).toHaveLength(2));
    expect(linkPosts()[1]?.body).toEqual({ parentId: null, links: [{ url: 'https://two.example/' }] });
  });

  it('над окном drop разрешён (иначе браузер уйдёт по ссылке), есть подсказка', async () => {
    await renderShell();
    const dt = linkTransfer('https://drag.example/');
    fireEvent.dragEnter(rootOf(), { dataTransfer: dt });
    expect(fireEvent.dragOver(rootOf(), { dataTransfer: dt })).toBe(false);
    expect(await screen.findByText(/ссылка добавится в эту папку/)).toBeInTheDocument();
    fireEvent.dragLeave(rootOf(), { dataTransfer: dt });
    expect(screen.queryByText(/ссылка добавится в эту папку/)).toBeNull();
  });

  it('на карточку записи: ссылка становится её вложением', async () => {
    await renderShell();
    fireEvent.drop(cardOf('Пример'), { dataTransfer: linkTransfer('https://att.example/') });
    await screen.findByText('Ссылка добавлена');
    expect(linkPosts()).toHaveLength(1); // окно поверх карточки второй раз не добавляет
    expect(linkPosts()[0]?.body).toEqual({ parentId: 2, links: [{ url: 'https://att.example/' }] });
  });

  it('на карточку папки: ссылка внутри папки', async () => {
    await renderShell();
    fireEvent.drop(cardOf('Папка'), { dataTransfer: linkTransfer('https://in-folder.example/') });
    await screen.findByText('Ссылка добавлена');
    expect(linkPosts()[0]?.body).toEqual({ parentId: 3, links: [{ url: 'https://in-folder.example/' }] });
  });

  it('текст не ссылка - «Это не ссылка»', async () => {
    await renderShell();
    fireEvent.drop(rootOf(), { dataTransfer: transfer({ 'text/plain': 'просто слова' }) });
    expect(await screen.findByText('Это не ссылка')).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(0);
  });

  it('файлы из проводника - по-прежнему импорт, не ссылки', async () => {
    mocks.importEntries.mockResolvedValue({ imported: 1, replaced: 0, skipped: 0, failed: 0, failures: [] });
    await renderShell();
    const file = new File(['x'], 'файл.txt');
    fireEvent.drop(rootOf(), { dataTransfer: transfer({}, ['Files'], [file]) });
    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalled());
    expect(linkPosts()).toHaveLength(0);
  });

  it('перетаскивание карточек окно не трогает: не разрешает drop и ссылок не создаёт', async () => {
    await renderShell();
    const dt = transfer({ [DRAG_MIME]: '1', 'text/plain': 'https://x.example/' });
    expect(fireEvent.dragOver(rootOf(), { dataTransfer: dt })).toBe(true);
    fireEvent.drop(rootOf(), { dataTransfer: dt });
    expect(linkPosts()).toHaveLength(0);
  });

  it('текст, брошенный в поле ввода, ссылкой не становится', async () => {
    await renderShell();
    const search = screen.getByLabelText('Поиск по именам во всём сейфе');
    fireEvent.drop(search, { dataTransfer: linkTransfer('https://x.example/') });
    expect(linkPosts()).toHaveLength(0);
  });
});

describe('закладки браузера (UF-20)', () => {
  const pickBookmarks = (html: string) => {
    const input = screen.getByLabelText('Файл закладок');
    fireEvent.change(input, { target: { files: [new File([html], 'bookmarks.html', { type: 'text/html' })] } });
  };

  it('пункт «Закладки браузера…» в меню «Импорт» открывает выбор .html', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const user = await renderShell();
    await user.click(screen.getByRole('button', { name: /Импорт/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Закладки браузера…' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Файл закладок')).toHaveAttribute('accept', expect.stringContaining('.html'));
  });

  it('экспорт Chrome: пути папок и названия уходят в POST /links, итог - одним тостом', async () => {
    await renderShell();
    pickBookmarks(chromeExport);
    expect(await screen.findByText('Закладки: создано 6, некорректных 3')).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(1);
    const body = linkPosts()[0]?.body as { parentId: number | null; links: NewLink[] };
    expect(body.parentId).toBeNull();
    expect(body.links).toHaveLength(6);
    expect(body.links[2]).toEqual({
      url: 'https://old.example.org/',
      name: 'Старый сайт',
      path: 'Bookmarks bar/Работа/Архив',
    });
  });

  it('большой файл идёт пачками по 1000; уже бывшие и некорректные считаются', async () => {
    const items = Array.from({ length: 1500 }, (_, i) => `<DT><A HREF="https://site${i}.example/">Сайт ${i}</A>`);
    const html = `<DL><p><DT><H3>Много</H3><DL><p>${items.join('\n')}</DL><p>\n<DT><A HREF="javascript:void(0)">x</A></DL>`;
    server.routes['POST /api/v1/links'] = (c) => {
      const links = (c.body as { links: NewLink[] }).links;
      const reply = createdAll(links.slice(1)); // первая из каждой пачки уже была в сейфе
      return { status: 201, json: { ...reply, existing: [{ url: links[0]?.url ?? '', entryId: 50 }] } };
    };
    await renderShell();
    pickBookmarks(html);
    expect(await screen.findByText('Закладки: создано 1498, уже было 2, некорректных 1')).toBeInTheDocument();
    expect(linkPosts().map((c) => (c.body as { links: unknown[] }).links.length)).toEqual([1000, 500]);
    expect((linkPosts()[0]?.body as { links: NewLink[] }).links[0]).toEqual({
      url: 'https://site0.example/',
      name: 'Сайт 0',
      path: 'Много',
    });
    expect(screen.getByText('Импорт закладок: 1500…')).toBeInTheDocument();
  });

  it('в открытых вложениях - parentId записи', async () => {
    await renderShell();
    fireEvent.contextMenu(cardOf('кот.jpg'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Открыть вложения/ }));
    await waitFor(() => expect(entryGets().some((c) => c.query.get('parentId') === '1')).toBe(true));
    pickBookmarks('<DL><DT><A HREF="https://a.com/">A</A></DL>');
    await screen.findByText('Закладки: создано 1');
    expect((linkPosts()[0]?.body as { parentId: number }).parentId).toBe(1);
  });

  it('файл без закладок - «В файле нет закладок»', async () => {
    await renderShell();
    pickBookmarks('<html><body><p>Не закладки</p></body></html>');
    expect(await screen.findByText('В файле нет закладок')).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(0);
  });

  it('ошибка сервера посреди импорта: причина и то, что успело создаться', async () => {
    let n = 0;
    server.routes['POST /api/v1/links'] = (c) => {
      n += 1;
      if (n === 2) return { status: 500, json: { error: { code: 'internal', message: 'Хранилище недоступно' } } };
      return { status: 201, json: createdAll((c.body as { links: NewLink[] }).links) };
    };
    const items = Array.from({ length: 1200 }, (_, i) => `<DT><A HREF="https://s${i}.example/">S${i}</A>`);
    await renderShell();
    pickBookmarks(`<DL>${items.join('\n')}</DL>`);
    expect(await screen.findByText('Хранилище недоступно')).toBeInTheDocument();
    expect(await screen.findByText('Закладки: создано 1000')).toBeInTheDocument();
  });
});

describe('предпросмотр ссылок (UF-21)', () => {
  const pendingLink = (pending: boolean) => ({ ...link, previewPending: pending });
  const listingOf = (entries: Entry[]) => ({ json: { parent: null, path: [], entries } });

  it('пока previewPending - листинг опрашивается раз в 2 с, потом опрос прекращается', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    server.routes['GET /api/v1/entries'] = () => {
      reads += 1;
      return listingOf([photo, pendingLink(reads < 3)]);
    };
    await renderShell();
    const pending = () => screen.queryByRole('img', { name: 'Загружается предпросмотр' });
    expect(pending()).not.toBeNull();
    expect(entryGets()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2100);
    expect(entryGets()).toHaveLength(2);
    expect(pending()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(pending()).toBeNull());
    expect(entryGets()).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(entryGets()).toHaveLength(3);
  });

  it('без ссылок в очереди листинг не опрашивается вовсе', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.routes['GET /api/v1/entries'] = () => listingOf([photo, pendingLink(false)]);
    await renderShell();
    await vi.advanceTimersByTimeAsync(9000);
    expect(entryGets()).toHaveLength(1);
    expect(screen.queryByRole('img', { name: 'Загружается предпросмотр' })).toBeNull();
  });

  it('в результатах поиска тоже опрашивается, пока есть ожидающие', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    server.routes['GET /api/v1/search'] = (c) => {
      reads += 1;
      return { json: { query: c.query.get('q'), results: [{ entry: pendingLink(reads < 2), path: [], matchedIn: 'name' }] } };
    };
    await renderShell();
    fireEvent.change(screen.getByLabelText('Поиск по именам во всём сейфе'), { target: { value: 'при' } });
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Загружается предпросмотр' })).not.toBeNull());
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Загружается предпросмотр' })).toBeNull());
    const searches = server.callsTo('GET', '/api/v1/search').length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.callsTo('GET', '/api/v1/search')).toHaveLength(searches);
  });

  it('«Обновить предпросмотр»: карточка перечитана, адрес миниатюры получает новую версию', async () => {
    server.routes['POST /api/v1/entries/2/preview'] = () => ({ json: link });
    await renderShell();
    const thumb = () => cardOf('Пример').querySelector('img')?.getAttribute('src');
    const before = thumb();
    expect(before).toMatch(/^\/api\/v1\/media\/2\/thumbnail\?v=/);
    const reads = entryGets().length;

    fireEvent.contextMenu(cardOf('Пример'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Обновить предпросмотр' }));
    expect(await screen.findByText('Предпросмотр обновлён')).toBeInTheDocument();
    await waitFor(() => expect(entryGets().length).toBeGreaterThan(reads));
    expect(thumb()).not.toBe(before);
  });
});

describe('настройки (UF-21)', () => {
  it('кнопка «Настройки» открывает поповер с переключателем и пояснением, PATCH - сразу', async () => {
    let linkPreviews = true;
    server.routes['GET /api/v1/settings'] = () => ({ json: { linkPreviews } });
    server.routes['PATCH /api/v1/settings'] = (c) => {
      linkPreviews = (c.body as { linkPreviews: boolean }).linkPreviews;
      return { json: { linkPreviews } };
    };
    const user = await renderShell();
    await user.click(screen.getByRole('button', { name: 'Настройки' }));
    const panel = await screen.findByRole('dialog', { name: 'Настройки' });
    expect(within(panel).getByText(/это запрос к сайту с этого компьютера/)).toBeInTheDocument();
    const toggle = await within(panel).findByRole('switch', { name: 'Загружать предпросмотр ссылок' });
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(server.callsTo('PATCH', '/api/v1/settings')[0]?.body).toEqual({ linkPreviews: false });
  });
});

describe('внешние ссылки (UF-19, UF-6)', () => {
  it('«Открыть» после подтверждения: window.open в новую вкладку с noopener', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderShell();
    fireEvent.click(cardOf('Пример'));
    const dialog = await screen.findByRole('dialog', { name: 'Открыть внешнюю ссылку' });
    expect(open).not.toHaveBeenCalled(); // без подтверждения страница не открывается
    fireEvent.click(within(dialog).getByRole('button', { name: 'Открыть' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', expect.stringContaining('noopener'));
  });
});
