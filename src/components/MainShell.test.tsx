import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setToken } from '../api/client';
import type { Listing } from '../api/types';
import { DRAG_MIME } from '../lib/move';
import { makeEntry } from '../test/factories';
import { MainShell } from './MainShell';
import { ToastProvider } from './Toasts';

// Интеграционные проверки главного окна на подставном сервере: панель свойств,
// вложения, перемещение и повторный импорт (UF-14, UF-15, UF-22, UF-6, UF-8).

const mocks = vi.hoisted(() => ({ importEntries: vi.fn(), triggerDownload: vi.fn() }));

vi.mock('../api/endpoints', async (original) => ({
  ...(await original<typeof import('../api/endpoints')>()),
  importEntries: mocks.importEntries,
}));
vi.mock('../lib/dom', async (original) => ({
  ...(await original<typeof import('../lib/dom')>()),
  triggerDownload: mocks.triggerDownload,
}));

const folder = makeEntry({ id: 3, kind: 'folder', name: 'Папка' });
const photo = makeEntry({
  id: 1,
  kind: 'photo',
  name: 'кот.jpg',
  size: 2048,
  childCount: 2,
  hasThumbnail: true,
  description: 'Рыжий кот',
});
const link = makeEntry({
  id: 2,
  kind: 'link',
  name: 'Пример',
  url: 'https://example.com',
  domain: 'example.com',
  description: '\nОписание ссылки\nвторая строка',
});
const attachment = makeEntry({ id: 4, name: 'вложение.txt', parentId: 1 });

const rootListing: Listing = { parent: null, path: [], entries: [folder, photo, link] };
const photoListing: Listing = {
  parent: photo,
  path: [{ id: 1, name: 'кот.jpg' }],
  entries: [attachment],
};

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Handler = (call: Call) => { status?: number; json?: unknown };

let calls: Call[] = [];
let overrides: Record<string, Handler> = {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function installServer(): void {
  calls = [];
  overrides = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      const override = overrides[`${call.method} ${call.path}`];
      if (override !== undefined) {
        const r = override(call);
        return json(r.json ?? {}, r.status);
      }
      switch (`${call.method} ${call.path}`) {
        case 'GET /api/v1/safe/status':
          return json({
            unlocked: true,
            authorized: true,
            lastPath: 'C:\\сейф.safebox',
            defaultDirectory: 'C:\\',
            safe: { path: 'C:\\сейф.safebox', entryCount: 4, idleRemainingSec: 900 },
          });
        case 'POST /api/v1/safe/heartbeat':
          return json({ idleRemainingSec: 900 });
        case 'GET /api/v1/entries':
          return json(call.query.get('parentId') === '1' ? photoListing : rootListing);
        case 'GET /api/v1/folders':
          return json({ folders: [{ id: 3, parentId: null, name: 'Папка' }] });
        case 'POST /api/v1/entries/move/plan':
          return json({ conflicts: [] });
        case 'POST /api/v1/entries/move':
          return json({ moved: 1, replaced: 0, skipped: 0 });
        case 'POST /api/v1/import/plan':
          return json({ conflicts: [], newFiles: 1 });
        default:
          return json({ error: { code: 'not_found', message: `нет ${call.method} ${call.path}` } }, 404);
      }
    }),
  );
}

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

async function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MainShell onLocked={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('кот.jpg');
  return { ...view, user: userEvent.setup() };
}

/** Корень карточки (у неё title и draggable) по имени записи. */
function cardOf(name: string): HTMLElement {
  const el = screen.getAllByTitle(new RegExp(`^${name}`)).find((e) => e.hasAttribute('draggable'));
  if (el === undefined) throw new Error(`нет карточки «${name}»`);
  return el;
}

const pick = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('checkbox', { name: `Выбрать «${name}»` }));

async function menuAction(card: string, item: string | RegExp): Promise<void> {
  fireEvent.contextMenu(cardOf(card));
  const name = typeof item === 'string' ? new RegExp(`^${item}`) : item;
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  setToken('t');
  installServer();
  mocks.importEntries.mockReset();
  mocks.triggerDownload.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('карточки', () => {
  it('бейдж вложений, описание ссылки и картинка предпросмотра', async () => {
    await renderShell();
    expect(screen.getByTitle('Вложений: 2')).toBeInTheDocument();
    expect(screen.getByText('Описание ссылки')).toBeInTheDocument();
    expect(screen.queryByText('вторая строка')).toBeNull();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });
});

describe('вложения (UF-14)', () => {
  it('«Открыть вложения» листает запись как папку, крошки идут через неё', async () => {
    await renderShell();
    await menuAction('кот.jpg', 'Открыть вложения');
    expect(await screen.findByText('вложение.txt')).toBeInTheDocument();
    expect(callsTo('GET', '/api/v1/entries').some((c) => c.query.get('parentId') === '1')).toBe(true);
    const crumbs = screen.getByRole('navigation', { name: 'Путь' });
    expect(within(crumbs).getByRole('button', { name: 'кот.jpg' })).toHaveAttribute('aria-current', 'page');
  });

  it('импорт в открытые вложения идёт с parentId записи', async () => {
    mocks.importEntries.mockResolvedValue({ imported: 1, replaced: 0, skipped: 0, failed: 0, failures: [] });
    const { container } = await renderShell();
    await menuAction('кот.jpg', 'Открыть вложения');
    await screen.findByText('вложение.txt');
    const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'новый.txt')] } });
    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalled());
    expect(callsTo('POST', '/api/v1/import/plan')[0]?.query.get('parentId')).toBe('1');
    expect(mocks.importEntries.mock.calls[0]?.[0]).toBe(1);
  });

  it('«Скачать вложения» - zip вложений, «Скачать» - сам файл', async () => {
    await renderShell();
    await menuAction('кот.jpg', 'Скачать вложения');
    expect(mocks.triggerDownload).toHaveBeenCalledWith('/api/v1/media/1/zip');
    await menuAction('кот.jpg', /^Скачать$/);
    expect(mocks.triggerDownload).toHaveBeenLastCalledWith('/api/v1/media/1/download');
  });

  it('удаление записи с вложениями предупреждает о вложениях', async () => {
    await renderShell();
    await menuAction('кот.jpg', 'Удалить');
    expect(await screen.findByText(/Записи с вложениями удаляются вместе с вложениями/)).toBeInTheDocument();
  });
});

describe('перемещение (UF-14)', () => {
  it('«Переместить…» из меню: выбор папки, план, перемещение, тост', async () => {
    await renderShell();
    await menuAction('кот.jpg', 'Переместить…');
    const dialog = await screen.findByRole('dialog', { name: 'Переместить «кот.jpg»' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Папка/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Переместить' }));
    expect(await screen.findByText('Перемещено: 1')).toBeInTheDocument();
    expect(callsTo('POST', '/api/v1/entries/move/plan')[0]?.body).toEqual({ ids: [1], parentId: 3 });
    expect(callsTo('POST', '/api/v1/entries/move')[0]?.body).toEqual({ ids: [1], parentId: 3 });
  });

  it('панель выделения: «Переместить…» переносит все выделенные', async () => {
    const { user } = await renderShell();
    await pick(user, 'кот.jpg');
    await pick(user, 'Пример');
    const bar = screen.getByRole('toolbar', { name: 'Действия с выделенным' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Переместить…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Переместить 2 объекта' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Папка/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Переместить' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/entries/move')).toHaveLength(1));
    expect(callsTo('POST', '/api/v1/entries/move')[0]?.body).toEqual({ ids: [1, 2], parentId: 3 });
  });

  it('занятое имя: тот же диалог, решение уходит в resolutions', async () => {
    overrides['POST /api/v1/entries/move/plan'] = () => ({
      json: { conflicts: [{ id: 1, existing: makeEntry({ id: 40, name: 'кот.jpg', size: 10, modifiedAt: 5 }) }] },
    });
    await renderShell();
    await menuAction('кот.jpg', 'Переместить…');
    const dialog = await screen.findByRole('dialog', { name: 'Переместить «кот.jpg»' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Папка/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Переместить' }));
    const conflict = await screen.findByRole('dialog', { name: 'В папке уже есть 1 запись с таким же именем' });
    fireEvent.click(within(conflict).getByRole('button', { name: 'Заменить' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/entries/move')).toHaveLength(1));
    expect(callsTo('POST', '/api/v1/entries/move')[0]?.body).toEqual({
      ids: [1],
      parentId: 3,
      resolutions: { '1': 'replace' },
    });
  });

  it('отказ сервера (в себя или потомка) - тост с причиной', async () => {
    overrides['POST /api/v1/entries/move/plan'] = () => ({
      status: 422,
      json: { error: { code: 'invalid_argument', message: 'Нельзя переместить запись в саму себя' } },
    });
    await renderShell();
    await menuAction('кот.jpg', 'Переместить…');
    const dialog = await screen.findByRole('dialog', { name: 'Переместить «кот.jpg»' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Папка/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Переместить' }));
    expect(await screen.findByText('Нельзя переместить запись в саму себя')).toBeInTheDocument();
    expect(callsTo('POST', '/api/v1/entries/move')).toHaveLength(0);
  });

  it('перетаскивание карточки на карточку папки', async () => {
    await renderShell();
    const dt = { types: [DRAG_MIME], setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(cardOf('кот.jpg'), { dataTransfer: dt });
    fireEvent.dragOver(cardOf('Папка'), { dataTransfer: dt });
    fireEvent.drop(cardOf('Папка'), { dataTransfer: dt });
    expect(await screen.findByText('Перемещено: 1')).toBeInTheDocument();
    expect(callsTo('POST', '/api/v1/entries/move')[0]?.body).toEqual({ ids: [1], parentId: 3 });
  });

  it('перетаскивание на узел дерева папок', async () => {
    await renderShell();
    const dt = { types: [DRAG_MIME], setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const tree = await screen.findByRole('navigation', { name: 'Папки' });
    const node = await within(tree).findByRole('button', { name: /Папка/ });
    fireEvent.dragStart(cardOf('Пример'), { dataTransfer: dt });
    fireEvent.drop(node, { dataTransfer: dt });
    await waitFor(() => expect(callsTo('POST', '/api/v1/entries/move')).toHaveLength(1));
    expect(callsTo('POST', '/api/v1/entries/move')[0]?.body).toEqual({ ids: [2], parentId: 3 });
  });
});

describe('повторный импорт (UF-15)', () => {
  const pickFiles = (container: HTMLElement, ...names: string[]) => {
    const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: names.map((n) => new File(['data'], n, { lastModified: 5 })) } });
  };

  it('нет совпадений - загрузка без вопросов, manifest с датой файла', async () => {
    mocks.importEntries.mockResolvedValue({ imported: 1, replaced: 0, skipped: 0, failed: 0, failures: [] });
    const { container } = await renderShell();
    pickFiles(container, 'a.txt');
    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.importEntries.mock.calls[0]?.[2]).toMatchObject({
      manifest: { files: { 'a.txt': { lastModified: 5 } } },
    });
    expect(await screen.findByText('Импортировано: 1')).toBeInTheDocument();
  });

  it('совпадение: диалог, «Заменить» - загрузка с replace, тост с итогом', async () => {
    overrides['POST /api/v1/import/plan'] = () => ({
      json: { conflicts: [{ path: 'a.txt', existing: makeEntry({ id: 9, name: 'a.txt', size: 3 }) }], newFiles: 1 },
    });
    mocks.importEntries.mockResolvedValue({ imported: 1, replaced: 1, skipped: 0, failed: 0, failures: [] });
    const { container } = await renderShell();
    pickFiles(container, 'a.txt', 'b.txt');
    const dialog = await screen.findByRole('dialog', { name: 'В папке уже есть 1 файл с таким же именем' });
    expect(mocks.importEntries).not.toHaveBeenCalled(); // байты не уходят, пока не решено
    fireEvent.click(within(dialog).getByRole('button', { name: 'Заменить' }));
    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalled());
    expect(mocks.importEntries.mock.calls[0]?.[2]).toMatchObject({
      manifest: { files: { 'a.txt': { onConflict: 'replace' }, 'b.txt': {} } },
    });
    expect(await screen.findByText('Импортировано: 1, заменено: 1')).toBeInTheDocument();
  });

  it('закрыть диалог - весь импорт отменён', async () => {
    overrides['POST /api/v1/import/plan'] = () => ({
      json: { conflicts: [{ path: 'a.txt', existing: makeEntry({ id: 9 }) }], newFiles: 0 },
    });
    const { container, user } = await renderShell();
    pickFiles(container, 'a.txt', 'b.txt');
    await screen.findByRole('dialog', { name: /В папке уже есть/ });
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Импорт отменён')).toBeInTheDocument();
    expect(mocks.importEntries).not.toHaveBeenCalled();
  });
});

describe('панель свойств (UF-22)', () => {
  it('Alt+Enter открывает панель, она следует за выделением, Esc закрывает', async () => {
    const { user } = await renderShell();
    await pick(user, 'кот.jpg');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    expect(within(panel).getByLabelText('Имя')).toHaveValue('кот.jpg');
    expect(within(panel).getByLabelText('Описание')).toHaveValue('Рыжий кот');

    await user.keyboard('{ArrowRight}'); // выделение ушло на следующую карточку
    expect(within(panel).getByLabelText('Имя')).toHaveValue('Пример');
    expect(within(panel).getByLabelText('Адрес')).toHaveValue('https://example.com');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Свойства' })).toBeNull();
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument(); // первый Esc закрыл панель, не выделение
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Выбрано: 1')).toBeNull();
  });

  it('открывается из меню карточки и панели выделения, закрывается крестиком', async () => {
    const { user } = await renderShell();
    await menuAction('Пример', 'Свойства');
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    expect(within(panel).getByLabelText('Адрес')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /Закрыть свойства/ }));
    expect(screen.queryByRole('complementary', { name: 'Свойства' })).toBeNull();

    const bar = screen.getByRole('toolbar', { name: 'Действия с выделенным' });
    await user.click(within(bar).getByRole('button', { name: 'Свойства' }));
    expect(await screen.findByRole('complementary', { name: 'Свойства' })).toBeInTheDocument();
  });

  it('имя правится на месте: PATCH при уходе из поля', async () => {
    overrides['PATCH /api/v1/entries/1'] = (call) => ({ json: { ...photo, ...(call.body as object) } });
    const { user } = await renderShell();
    await menuAction('кот.jpg', 'Свойства');
    const name = await screen.findByLabelText('Имя');
    await user.clear(name);
    await user.type(name, 'кошка.jpg');
    await user.tab();
    await waitFor(() => expect(callsTo('PATCH', '/api/v1/entries/1')).toHaveLength(1));
    expect(callsTo('PATCH', '/api/v1/entries/1')[0]?.body).toEqual({ name: 'кошка.jpg' });
  });

  it('описание - отдельным PATCH, ошибка 422 - под полем', async () => {
    overrides['PATCH /api/v1/entries/1'] = () => ({
      status: 422,
      json: { error: { code: 'invalid_argument', message: 'Описание слишком длинное' } },
    });
    const { user } = await renderShell();
    await menuAction('кот.jpg', 'Свойства');
    const description = await screen.findByLabelText('Описание');
    await user.type(description, ' и рыжий');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Описание слишком длинное');
    expect(callsTo('PATCH', '/api/v1/entries/1')[0]?.body).toEqual({ description: 'Рыжий кот и рыжий' });
  });

  it('без выделения - свойства открытой записи с вложениями', async () => {
    const { user } = await renderShell();
    await menuAction('кот.jpg', 'Открыть вложения');
    await screen.findByText('вложение.txt');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    const panel = await screen.findByRole('complementary', { name: 'Свойства' });
    expect(within(panel).getByLabelText('Имя')).toHaveValue('кот.jpg');
    expect(within(panel).getByText('открытая папка')).toBeInTheDocument();
  });
});

describe('рамка выделения (UF-9)', () => {
  it('протяжка с фона выделяет карточки под рамкой; клик сразу после - не сброс', async () => {
    await renderShell();
    const main = screen.getByRole('main');
    // jsdom без PointerEvent: шлём MouseEvent с pointer-типом (button/clientX доезжают)
    main.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    await waitFor(() => expect(screen.getByText('Выбрано: 3')).toBeInTheDocument());
    // отпускание рамки рождает клик по фону - он не должен снимать свежее выделение
    fireEvent.click(main);
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument();
    // следующий честный клик по фону - сбрасывает
    fireEvent.click(main);
    expect(screen.queryByText(/Выбрано: /)).toBeNull();
  });

  it('клик по фону без протяжки по-прежнему сбрасывает выделение', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
    await user.click(screen.getByRole('main'));
    expect(screen.queryByText(/Выбрано: /)).toBeNull();
  });
});

describe('«Различить имена» - приписки одинаковым именам', () => {
  const dup1 = makeEntry({ id: 21, kind: 'photo', name: 'dup.jpg' });
  const dup2 = makeEntry({ id: 22, kind: 'photo', name: 'DUP.jpg' }); // без учёта регистра - та же группа
  const keep = makeEntry({ id: 23, kind: 'file', name: 'отчёт.txt' });

  it('кнопка выделяет дубли: первая остаётся, остальные получают (2)', async () => {
    overrides['GET /api/v1/entries'] = () => ({
      json: { ...rootListing, entries: [folder, dup1, dup2, keep] },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MainShell onLocked={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('dup.jpg');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «dup.jpg»' }));
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «DUP.jpg»' }));
    await user.click(screen.getByRole('button', { name: 'Различить имена' }));
    const dialog = await screen.findByRole('dialog', { name: /Различить имена/ });
    expect(dialog).toHaveTextContent('DUP.jpg → DUP (2).jpg');
    overrides['PATCH /api/v1/entries/22'] = () => ({ json: { ...dup2, name: 'DUP (2).jpg' } });
    await user.click(within(dialog).getByRole('button', { name: 'Переименовать' }));
    await waitFor(() => expect(callsTo('PATCH', '/api/v1/entries/22')[0]?.body).toEqual({ name: 'DUP (2).jpg' }));
    expect(await screen.findByText(/Переименовано: 1/)).toBeInTheDocument();
  });

  it('одинаковые имена из разных папок (поиск) - конфликтов нет, ничего не меняется', async () => {
    // как в результатах поиска: два IMG.jpg лежат в разных папках
    const fromA = makeEntry({ id: 31, kind: 'photo', name: 'IMG.jpg', parentId: 3 });
    const fromB = makeEntry({ id: 32, kind: 'photo', name: 'IMG.jpg', parentId: 9 });
    overrides['GET /api/v1/entries'] = () => ({
      json: { ...rootListing, entries: [folder, fromA, fromB] },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MainShell onLocked={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await screen.findAllByText('IMG.jpg');
    await user.click(screen.getAllByRole('checkbox', { name: 'Выбрать «IMG.jpg»' })[0]!);
    await user.click(screen.getAllByRole('checkbox', { name: 'Выбрать «IMG.jpg»' })[1]!);
    await user.click(screen.getByRole('button', { name: 'Различить имена' }));
    expect(await screen.findByText('Одинаковые имена — в разных папках, конфликтов нет')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Различить имена/ })).toBeNull();
    expect(callsTo('PATCH', '/api/v1/entries/31')).toHaveLength(0);
    expect(callsTo('PATCH', '/api/v1/entries/32')).toHaveLength(0);
  });

  it('нет дублей - информационный тост, диалога нет', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «Пример»' }));
    await user.click(screen.getByRole('button', { name: 'Различить имена' }));
    expect(await screen.findByText('Среди выделенных нет одинаковых имён')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Различить имена/ })).toBeNull();
  });

  it('одна выделенная - кнопка недоступна', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    expect(screen.getByRole('button', { name: 'Различить имена' })).toBeDisabled();
  });
});

describe('Ctrl+A - выделить всё в текущем виде (UF-9)', () => {
  it('выделяет все карточки текущей папки', async () => {
    const { user } = await renderShell();
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument();
  });

  it('работает на русской раскладке (e.key = «ф», физическая клавиша A)', async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: 'ф', code: 'KeyA', ctrlKey: true });
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument();
  });

  it('в поле ввода выделяет текст, а не карточки', async () => {
    const { user } = await renderShell();
    const search = screen.getByLabelText('Поиск по именам во всём сейфе');
    await user.click(search);
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.queryByText(/Выбрано: /)).toBeNull();
  });
});

describe('ссылка (UF-6)', () => {
  it('«Копировать адрес» кладёт URL в буфер', async () => {
    await renderShell(); // userEvent.setup() подставляет свой буфер обмена
    await menuAction('Пример', 'Копировать адрес');
    expect(await screen.findByText('Адрес скопирован')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('https://example.com');
  });

  it('«Обновить предпросмотр»: успех - тост, 502 - сообщение сервера', async () => {
    overrides['POST /api/v1/entries/2/preview'] = () => ({ json: link });
    await renderShell();
    await menuAction('Пример', 'Обновить предпросмотр');
    expect(await screen.findByText('Предпросмотр обновлён')).toBeInTheDocument();

    overrides['POST /api/v1/entries/2/preview'] = () => ({
      status: 502,
      json: { error: { code: 'preview_failed', message: 'Сайт не ответил за 10 секунд' } },
    });
    await menuAction('Пример', 'Обновить предпросмотр');
    expect(await screen.findByText('Сайт не ответил за 10 секунд')).toBeInTheDocument();
  });

  it('клик по ссылке по-прежнему спрашивает подтверждение', async () => {
    await renderShell();
    fireEvent.click(cardOf('Пример'));
    expect(await screen.findByRole('dialog', { name: 'Открыть внешнюю ссылку' })).toBeInTheDocument();
  });
});

describe('поиск (UF-8)', () => {
  it('совпадение в описании помечено', async () => {
    overrides['GET /api/v1/search'] = () => ({
      json: {
        query: 'рыжий',
        results: [
          { entry: photo, path: [], matchedIn: 'description' },
          { entry: link, path: [{ id: 3, name: 'Папка' }], matchedIn: 'name' },
        ],
      },
    });
    const { user } = await renderShell();
    await user.type(screen.getByLabelText('Поиск по именам во всём сейфе'), 'рыжий');
    expect(await screen.findByText('в описании')).toBeInTheDocument();
    expect(screen.getAllByText('в описании')).toHaveLength(1);
  });
});
