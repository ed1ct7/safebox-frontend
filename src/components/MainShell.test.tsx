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

  it('«Удалить» из меню - сразу в корзину, без вопроса', async () => {
    overrides['DELETE /api/v1/entries/1'] = () => ({ json: { removed: 1 } });
    await renderShell();
    await menuAction('кот.jpg', 'Удалить');
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/entries/1')).toHaveLength(1));
    expect(await screen.findByText(/В корзину: 1 объект/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Удалить/ })).toBeNull();
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

  it('«Оставить оба»: лежащие в папке переименовываются в «имя (2)», переносимое сохраняет имя', async () => {
    // первая проверка плана - конфликт, после переименования лежащего - чисто
    let plans = 0;
    overrides['POST /api/v1/entries/move/plan'] = () => {
      plans += 1;
      return plans === 1
        ? { json: { conflicts: [{ id: 1, existing: makeEntry({ id: 40, name: 'кот.jpg', size: 10, modifiedAt: 5 }) }] } }
        : { json: { conflicts: [] } };
    };
    overrides['PATCH /api/v1/entries/40'] = () => ({ json: makeEntry({ id: 40, name: 'кот (2).jpg' }) });
    // в папке назначения (id 3) лежит тот самый «кот.jpg»
    overrides['GET /api/v1/entries'] = (c) => ({
      json: c.query.get('parentId') === '3'
        ? { parent: null, path: [], entries: [makeEntry({ id: 40, kind: 'folder', name: 'Папка' }), makeEntry({ id: 40, name: 'кот.jpg' })] }
        : rootListing,
    });
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    const bar = screen.getByRole('toolbar', { name: 'Действия с выделенным' });
    await user.click(within(bar).getByRole('button', { name: 'Переместить…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Переместить «кот.jpg»' });
    await user.click(within(dialog).getByRole('button', { name: /Папка/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Переместить' }));
    const conflict = await screen.findByRole('dialog', { name: /В папке уже есть/ });
    await user.click(within(conflict).getByRole('button', { name: 'Оставить оба' }));
    await waitFor(() => expect(callsTo('PATCH', '/api/v1/entries/40')).toHaveLength(1));
    expect(callsTo('PATCH', '/api/v1/entries/40')[0]?.body).toEqual({ name: 'кот (2).jpg' });
    await waitFor(() => expect(callsTo('POST', '/api/v1/entries/move')).toHaveLength(1));
    expect((callsTo('POST', '/api/v1/entries/move')[0]?.body as { resolutions?: unknown }).resolutions).toBeUndefined();
    expect(plans).toBe(2); // после переименования план переспрошен
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

describe('модель B: клик выделяет, двойной клик открывает', () => {
  it('клик выделяет и не открывает; двойной клик открывает просмотр', async () => {
    await renderShell();
    fireEvent.click(cardOf('кот.jpg'));
    expect(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.doubleClick(cardOf('кот.jpg'));
    expect(await screen.findByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
  });

  it('двойной клик: текст и аудио - в просмотр, прочий файл - скачивается', async () => {
    const txt = makeEntry({ id: 11, name: 'заметки.txt', mime: 'text/plain' });
    const oga = makeEntry({ id: 12, name: 'голос.oga', mime: 'application/octet-stream' });
    const docx = makeEntry({ id: 13, name: 'отчёт.docx', mime: 'application/zip' });
    overrides['GET /api/v1/entries'] = () => ({ json: { ...rootListing, entries: [...rootListing.entries, txt, oga, docx] } });
    const media = [
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined),
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined),
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined),
    ]; // jsdom не играет медиа
    await renderShell();
    fireEvent.doubleClick(cardOf('заметки.txt'));
    expect(await screen.findByRole('dialog', { name: 'Просмотр текста' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // фото, текст и аудио - одна лента
    expect(await screen.findByRole('dialog', { name: 'Прослушивание' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' }); // Modal слушает document
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.doubleClick(cardOf('отчёт.docx'));
    expect(mocks.triggerDownload).toHaveBeenCalledWith('/api/v1/media/13/download');
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const spy of media) spy.mockRestore();
  });

  it('двойной клик по папке переходит в неё', async () => {
    await renderShell();
    fireEvent.doubleClick(cardOf('Папка'));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/entries' && c.query.get('parentId') === '3')).toBe(true));
  });

  it('пробел - быстрый просмотр выделенного фото, пробел в просмотре закрывает', async () => {
    await renderShell();
    fireEvent.click(cardOf('кот.jpg'));
    fireEvent.keyDown(window, { key: ' ' });
    expect(await screen.findByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Просмотр фото' })).toBeNull());
  });

  it('Shift+стрелка расширяет выделение', async () => {
    await renderShell();
    fireEvent.click(cardOf('Папка'));
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByRole('checkbox', { name: 'Выбрать «Папка»' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' })).toHaveAttribute('aria-checked', 'true');
  });

  it('↑/↓ ходят по строкам сетки (колонки - по offsetTop карточек)', async () => {
    // jsdom не раскладывает: две колонки - строка карточки по её номеру среди карточек
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const cards = [...document.querySelectorAll('[data-entry-id]')];
      const i = cards.indexOf(this);
      return i < 0 ? 0 : Math.floor(i / 2) * 100;
    });
    try {
      await renderShell();
      const checked = (name: string) => screen.getByRole('checkbox', { name: `Выбрать «${name}»` }).getAttribute('aria-checked');
      fireEvent.click(cardOf('Папка'));
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      expect(checked('Пример')).toBe('true'); // Папка | кот.jpg / Пример
      expect(checked('Папка')).toBe('false');
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      expect(checked('Папка')).toBe('true');
      fireEvent.click(cardOf('кот.jpg'));
      fireEvent.keyDown(window, { key: 'ArrowDown' }); // под ним пусто - на последнюю
      expect(checked('Пример')).toBe('true');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Delete - в корзину', () => {
  const dogPhoto = makeEntry({ id: 24, kind: 'photo', name: 'пёс.jpg' });

  beforeEach(() => {
    overrides['DELETE /api/v1/entries/1'] = () => ({ json: { removed: 1 } });
    overrides['POST /api/v1/trash/restore'] = () => ({ json: { restored: 1, renamed: [] } });
  });

  it('по выделению в галерее: Delete сразу в корзину, «Отменить» возвращает', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/entries/1')).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: /Удалить/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/restore')).toHaveLength(1));
    expect(callsTo('POST', '/api/v1/trash/restore')[0]?.body).toEqual({ ids: [1] });
    expect(await screen.findByText(/Восстановлено: 1 объект/)).toBeInTheDocument();
  });

  it('Ctrl+Z возвращает последнее удалённое; второй раз и «Отменить» после - нечего', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    fireEvent.keyDown(window, { key: 'Delete' });
    await screen.findByText(/В корзину: 1 объект/);
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/restore')).toHaveLength(1));
    await screen.findByText(/Восстановлено/);
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(callsTo('POST', '/api/v1/trash/restore')).toHaveLength(1);
  });

  it('в просмотре фото: Delete сразу в корзину, показывается следующее', async () => {
    overrides['GET /api/v1/entries'] = () => ({
      json: { ...rootListing, entries: [folder, photo, dogPhoto, link] },
    });
    await renderShell();
    fireEvent.doubleClick(cardOf('кот.jpg'));
    await screen.findByRole('dialog', { name: 'Просмотр фото' });
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/entries/1')).toHaveLength(1));
    const viewer = await screen.findByRole('dialog', { name: 'Просмотр фото' });
    await waitFor(() => expect(within(viewer).getByText('пёс.jpg')).toBeInTheDocument()); // следующий на месте удалённого
    expect(within(viewer).queryByText('кот.jpg')).toBeNull();
  });

  it('в поле ввода Delete правит текст, а не удаляет выделенное', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    const search = screen.getByLabelText('Поиск по именам во всём сейфе');
    await user.click(search);
    fireEvent.keyDown(search, { key: 'Delete' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' })).toHaveAttribute('aria-checked', 'true');
    expect(callsTo('DELETE', '/api/v1/entries/1')).toHaveLength(0);
  });

  it('автоповтор зажатого Delete не удаляет', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    fireEvent.keyDown(window, { key: 'Delete', repeat: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(callsTo('DELETE', '/api/v1/entries/1')).toHaveLength(0);
  });

  it('не вернулось с сервера - Ctrl+Z можно повторить', async () => {
    let fail = true;
    overrides['POST /api/v1/trash/restore'] = () =>
      fail ? { status: 503, json: { error: { code: 'busy', message: 'Сервер занят' } } } : { json: { restored: 1, renamed: [] } };
    const { user } = await renderShell();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать «кот.jpg»' }));
    fireEvent.keyDown(window, { key: 'Delete' });
    await screen.findByText(/В корзину: 1 объект/);
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/restore')).toHaveLength(1));
    await screen.findByText(/Сервер занят|Не удалось вернуть/);
    fail = false;
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/restore')).toHaveLength(2));
    expect(await screen.findByText(/Восстановлено: 1 объект/)).toBeInTheDocument();
  });
});

describe('большая папка (К2): страницами', () => {
  const many = [photo, ...Array.from({ length: 249 }, (_, i) => makeEntry({ id: 1000 + i, kind: 'photo', name: `ф${i}.jpg` }))];
  const page = (c: Call) => {
    const offset = Number(c.query.get('offset') ?? 0);
    const limit = Number(c.query.get('limit') ?? many.length);
    return { parent: null, path: [], entries: many.slice(offset, offset + limit), total: many.length };
  };

  it('первая страница сразу, остальные догружаются; на экране вся папка', async () => {
    overrides['GET /api/v1/entries'] = (c) => ({ json: page(c) });
    await renderShell();
    await waitFor(() => expect(document.querySelectorAll('[data-entry-id]')).toHaveLength(250));
    const reads = callsTo('GET', '/api/v1/entries');
    expect(reads.map((c) => [c.query.get('offset'), c.query.get('limit')])).toEqual([
      [null, '200'],
      ['200', '2000'],
    ]);
  });

  it('страница не загрузилась - видно в строке состояния, загруженное на месте', async () => {
    overrides['GET /api/v1/entries'] = (c) =>
      c.query.get('offset') === null ? { json: page(c) } : { status: 500, json: { error: { code: 'internal', message: 'сбой' } } };
    await renderShell();
    expect(await screen.findByText(/загрузка прервана: 200 из 250/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-entry-id]')).toHaveLength(200);
    // «выделить всё» по неполной папке не выделяет часть (Delete удалил бы не всё)
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(await screen.findByText(/Ещё загружается: 200 из 250 /)).toBeInTheDocument();
    expect(screen.queryByText(/Выбрано/)).not.toBeInTheDocument();
  });

  it('папка поменялась между страницами - перечитывается целиком', async () => {
    let shifted = true; // вторая страница в первый раз - уже после вставки записи
    overrides['GET /api/v1/entries'] = (c) => {
      const p = page(c);
      if (c.query.get('offset') !== null && shifted) {
        shifted = false;
        return { json: { ...p, total: many.length + 1 } };
      }
      return { json: p };
    };
    await renderShell();
    await waitFor(
      () =>
        expect(callsTo('GET', '/api/v1/entries').map((c) => c.query.get('offset'))).toEqual([null, '200', null, '200']),
      { timeout: 3000 },
    );
    await waitFor(() => expect(document.querySelectorAll('[data-entry-id]')).toHaveLength(250));
  });
});

describe('корзина', () => {
  const trashed = { ...makeEntry({ id: 9, kind: 'photo', name: 'старое.jpg' }), trashedAt: 1_700_000_000_000, location: [{ id: 3, name: 'Папка' }] };

  beforeEach(() => {
    overrides['GET /api/v1/trash'] = () => ({ json: { entries: [trashed], total: 1 } });
    overrides['POST /api/v1/trash/restore'] = () => ({ json: { restored: 1, renamed: [{ id: 9, name: 'старое (2).jpg' }] } });
    overrides['POST /api/v1/trash/purge'] = () => ({ json: { purged: 1 } });
  });

  it('пункт под деревом со счётчиком открывает корзину: откуда удалено', async () => {
    const { user } = await renderShell();
    await user.click(await screen.findByRole('button', { name: /Корзина\s*1/ }));
    const view = await screen.findByRole('region', { name: 'Корзина' });
    expect(await within(view).findByText('старое.jpg')).toBeInTheDocument();
    expect(within(view).getByText('Все объекты / Папка')).toBeInTheDocument();
  });

  it('«Восстановить» выделенное; занятое имя - в тосте', async () => {
    const { user } = await renderShell();
    await user.click(await screen.findByRole('button', { name: /Корзина/ }));
    await user.click(await screen.findByText('старое.jpg'));
    await user.click(screen.getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/restore')[0]?.body).toEqual({ ids: [9] }));
    expect(await screen.findByText(/старое \(2\)\.jpg/)).toBeInTheDocument();
  });

  it('«Удалить навсегда» и «Очистить корзину» - только после подтверждения', async () => {
    const { user } = await renderShell();
    await user.click(await screen.findByRole('button', { name: /Корзина/ }));
    await user.click(await screen.findByText('старое.jpg'));
    fireEvent.keyDown(window, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Удалить «старое.jpg» навсегда?' });
    expect(callsTo('POST', '/api/v1/trash/purge')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Удалить навсегда' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/purge')[0]?.body).toEqual({ ids: [9] }));

    await user.click(screen.getByRole('button', { name: 'Очистить корзину' }));
    const all = await screen.findByRole('dialog', { name: 'Очистить корзину?' });
    await user.click(within(all).getByRole('button', { name: 'Очистить' }));
    await waitFor(() => expect(callsTo('POST', '/api/v1/trash/purge')[1]?.body).toEqual({ all: true }));
  });

  it('поиск закрывает корзину', async () => {
    const { user } = await renderShell();
    await user.click(await screen.findByRole('button', { name: /Корзина/ }));
    await screen.findByRole('region', { name: 'Корзина' });
    await user.type(screen.getByLabelText('Поиск по именам во всём сейфе'), 'к');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Корзина' })).toBeNull());
  });

  it('клик по папке в дереве закрывает корзину', async () => {
    const { user } = await renderShell();
    await user.click(await screen.findByRole('button', { name: /Корзина/ }));
    await screen.findByRole('region', { name: 'Корзина' });
    await user.click(within(screen.getByRole('navigation', { name: 'Папки' })).getByTitle('Папка'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Корзина' })).toBeNull());
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

  it('двойной клик по ссылке по-прежнему спрашивает подтверждение', async () => {
    await renderShell();
    fireEvent.doubleClick(cardOf('Пример'));
    expect(await screen.findByRole('dialog', { name: 'Открыть внешнюю ссылку' })).toBeInTheDocument();
  });

  it('ролик YouTube играет в просмотрщике (youtube-nocookie), без подтверждения', async () => {
    const yt = makeEntry({ id: 7, kind: 'link', name: 'Ролик', url: 'https://youtu.be/jNQXAC9IVRw?t=5', domain: 'youtu.be' });
    overrides['GET /api/v1/entries'] = () => ({ json: { ...rootListing, entries: [folder, photo, link, yt] } });
    await renderShell();
    fireEvent.doubleClick(cardOf('Ролик'));
    const viewer = await screen.findByRole('dialog', { name: 'Просмотр ролика' });
    const frame = viewer.querySelector('iframe');
    expect(frame?.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/jNQXAC9IVRw\?.*start=5/);
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(screen.queryByRole('dialog', { name: 'Открыть внешнюю ссылку' })).toBeNull();
    // ← листает к фото того же вида
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
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
