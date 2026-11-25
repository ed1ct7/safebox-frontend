import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setToken } from '../api/client';
import type { Entry, ImportManifest, Listing } from '../api/types';
import { parseTable, serializeTable, TEMPLATES } from '../lib/table';
import { makeEntry } from '../test/factories';
import { MainShell } from './MainShell';
import { ToastProvider } from './Toasts';

// Таблицы в главном окне на подставном сервере: карточка, открытие, создание,
// сохранение перед блокировкой.

const mocks = vi.hoisted(() => ({ importEntries: vi.fn(), triggerDownload: vi.fn() }));

vi.mock('../api/endpoints', async (original) => ({
  ...(await original<typeof import('../api/endpoints')>()),
  importEntries: mocks.importEntries,
}));
vi.mock('../lib/dom', async (original) => ({
  ...(await original<typeof import('../lib/dom')>()),
  triggerDownload: mocks.triggerDownload,
}));

const note = makeEntry({ id: 1, name: 'заметка.txt' });
const table = makeEntry({ id: 5, name: 'Пароли.sbtable', size: 300, modifiedAt: 100 });

const stored = (() => {
  const doc = TEMPLATES[0]!.make();
  const [service, , password] = doc.columns;
  return serializeTable({
    ...doc,
    rows: [{ id: 'r1', cells: { [service!.id]: 'Почта', [password!.id]: 'qwerty-123' } }],
  });
})();

let entries: Entry[] = [];
let contents = new Map<number, string>();
let calls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function installServer(): void {
  entries = [note, table];
  contents = new Map([[5, stored]]);
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const key = `${init.method ?? 'GET'} ${url.pathname}`;
      calls.push(key);
      const one = /^GET \/api\/v1\/entries\/(\d+)$/.exec(key);
      if (one !== null) {
        const found = entries.find((e) => e.id === Number(one[1]));
        return found === undefined ? json({ error: { code: 'not_found', message: 'Запись не найдена' } }, 404) : json(found);
      }
      const media = /^GET \/api\/v1\/media\/(\d+)\/content$/.exec(key);
      if (media !== null) return new Response(contents.get(Number(media[1])) ?? '', { status: 200 });
      switch (key) {
        case 'GET /api/v1/safe/status':
          return json({
            unlocked: true,
            authorized: true,
            lastPath: 'C:\\сейф.safebox',
            defaultDirectory: 'C:\\',
            safe: { path: 'C:\\сейф.safebox', entryCount: 2, idleRemainingSec: 900 },
          });
        case 'POST /api/v1/safe/heartbeat':
          return json({ idleRemainingSec: 900 });
        case 'POST /api/v1/safe/lock':
          return json({});
        case 'GET /api/v1/entries':
          return json({ parent: null, path: [], entries } satisfies Listing);
        case 'GET /api/v1/folders':
          return json({ folders: [] });
        case 'POST /api/v1/import/plan': {
          const body = JSON.parse(init.body as string) as { files: { path: string }[] };
          const existing = entries.find((e) => e.name === body.files[0]!.path);
          return json({ conflicts: existing === undefined ? [] : [{ path: existing.name, existing }], newFiles: 0 });
        }
        default:
          return json({ error: { code: 'not_found', message: `нет ${key}` } }, 404);
      }
    }),
  );
  // импорт идёт через XHR: подставной сервер кладёт файл в «сейф»
  mocks.importEntries.mockImplementation(
    async (_parentId: number | null, files: File[], opts: { manifest: ImportManifest }) => {
      const file = files[0]!;
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(file);
      });
      const existing = entries.find((e) => e.name === file.name);
      if (existing !== undefined && opts.manifest.files[file.name]?.onConflict === 'replace') {
        contents.set(existing.id, text);
        entries = entries.map((e) => (e === existing ? { ...e, modifiedAt: e.modifiedAt + 1, size: text.length } : e));
        return { imported: 0, replaced: 1, skipped: 0, failed: 0, failures: [], importedFiles: [{ path: file.name, id: existing.id }] };
      }
      const created = makeEntry({ id: 40 + entries.length, name: file.name, size: text.length, modifiedAt: 500 });
      entries = [...entries, created];
      contents.set(created.id, text);
      return { imported: 1, replaced: 0, skipped: 0, failed: 0, failures: [], importedFiles: [{ path: file.name, id: created.id }] };
    },
  );
}

async function renderShell(onLocked = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MainShell onLocked={onLocked} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('заметка.txt');
  return { user: userEvent.setup(), onLocked };
}

function cardOf(name: string): HTMLElement {
  const el = screen.getAllByTitle(new RegExp(`^${name}`)).find((e) => e.hasAttribute('draggable'));
  if (el === undefined) throw new Error(`нет карточки «${name}»`);
  return el;
}

beforeEach(() => {
  setToken('test-token');
  installServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setToken(null);
});

describe('таблицы в главном окне', () => {
  it('карточка таблицы подписана «Таблица»; двойной клик открывает её, а не скачивает', async () => {
    const { user } = await renderShell();
    const card = cardOf('Пароли.sbtable');
    expect(within(card).getByText('Таблица')).toBeInTheDocument();

    await user.dblClick(card);
    const dialog = await screen.findByRole('dialog', { name: 'Таблица «Пароли»' });
    expect(await within(dialog).findByText('Почта')).toBeInTheDocument();
    expect(within(dialog).queryByText('qwerty-123')).not.toBeInTheDocument();
    expect(mocks.triggerDownload).not.toHaveBeenCalled();

    await user.dblClick(cardOf('заметка.txt')); // обычный файл по-прежнему скачивается
  });

  it('«▦ Таблица»: создаётся файл по заготовке в открытой папке и сразу открывается', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('button', { name: '▦ Таблица' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая таблица' });
    await user.click(within(dialog).getByRole('radio', { name: /Банковские карты/ }));
    expect(within(dialog).getByRole('textbox')).toHaveValue('Карты');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));

    const opened = await screen.findByRole('dialog', { name: 'Таблица «Карты»' });
    expect(await within(opened).findByRole('button', { name: /^CVV/ })).toBeInTheDocument();
    const created = entries.find((e) => e.name === 'Карты.sbtable');
    expect(created).toBeDefined();
    expect(parseTable(contents.get(created!.id)!).columns.map((c) => c.name)).toContain('Номер карты');
    expect(mocks.importEntries.mock.calls[0]![0]).toBeNull(); // корень: открытая папка
  });

  it('пустое или недопустимое название не создаёт таблицу', async () => {
    const { user } = await renderShell();
    await user.click(screen.getByRole('button', { name: '▦ Таблица' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая таблица' });
    await user.clear(within(dialog).getByRole('textbox'));
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'a/b');
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    expect(mocks.importEntries).not.toHaveBeenCalled();
  });

  it('блокировка сейфа сначала дописывает правку открытой таблицы', async () => {
    const { user, onLocked } = await renderShell();
    await user.dblClick(cardOf('Пароли.sbtable'));
    const dialog = await screen.findByRole('dialog', { name: 'Таблица «Пароли»' });
    await user.click(await within(dialog).findByText('Почта'));
    await user.keyboard('{Delete}');

    // кнопка блокировки под экраном таблицы: жмём её напрямую, как сделал бы хоткей
    screen.getByRole('button', { name: /Блокировка/ }).click();
    await waitFor(() => expect(onLocked).toHaveBeenCalled());

    expect(contents.get(5)).not.toContain('Почта');
    expect(contents.get(5)).toContain('qwerty-123');
    expect(calls.indexOf('POST /api/v1/safe/lock')).toBeGreaterThan(calls.lastIndexOf('POST /api/v1/import/plan'));
  });
});
