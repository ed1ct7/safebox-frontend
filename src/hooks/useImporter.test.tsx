import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiRequestError } from '../api/client';
import type { PendingFile } from '../api/endpoints';
import type { ImportManifest, ImportPlanResponse, ImportResult } from '../api/types';
import { makeEntry } from '../test/factories';
import { useImporter } from './useImporter';
import type { Resolutions } from '../lib/importPlan';

const mocks = vi.hoisted(() => ({
  planImport: vi.fn(),
  importEntries: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../api/endpoints', async (original) => ({
  ...(await original<typeof import('../api/endpoints')>()),
  planImport: mocks.planImport,
  importEntries: mocks.importEntries,
}));
vi.mock('../components/Toasts', () => ({ useToast: () => mocks.toast }));

const file = (name: string, path?: string, modified = 1000): PendingFile => {
  const f = new File(['data'], name, { lastModified: modified }) as PendingFile;
  if (path !== undefined) f.relativePath = path;
  return f;
};

const result = (extra: Partial<ImportResult> = {}): ImportResult => ({
  imported: 0,
  replaced: 0,
  skipped: 0,
  failed: 0,
  failures: [],
  ...extra,
});

function setup(ask: (r: unknown) => Promise<Resolutions | null> = () => Promise.resolve(new Map())) {
  const onBatchDone = vi.fn();
  const askConflicts = vi.fn(ask);
  const hook = renderHook(() =>
    useImporter({ onBatchDone, onActivity: vi.fn(), askConflicts: askConflicts as never }),
  );
  return { ...hook, onBatchDone, askConflicts };
}

const noConflicts: ImportPlanResponse = { conflicts: [], newFiles: 2 };

const uploaded = () => mocks.importEntries.mock.calls[0] as [number | null, PendingFile[], { manifest: ImportManifest }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useImporter: повторный импорт (UF-15)', () => {
  it('нет совпадений - вопросов нет, файлы уходят сразу, с manifest (lastModified)', async () => {
    mocks.planImport.mockResolvedValue(noConflicts);
    mocks.importEntries.mockResolvedValue(result({ imported: 2 }));
    const { result: hook, askConflicts, onBatchDone } = setup();
    act(() => hook.current.enqueue([file('a.txt', undefined, 11), file('b.txt', 'P/b.txt', 22)], 5));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    expect(mocks.planImport).toHaveBeenCalledWith(5, [
      { path: 'a.txt', size: 4 },
      { path: 'P/b.txt', size: 4 },
    ]);
    expect(askConflicts).not.toHaveBeenCalled();
    const [parent, sent, opts] = uploaded();
    expect(parent).toBe(5);
    expect(sent.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    expect(opts.manifest).toEqual({
      files: { 'a.txt': { lastModified: 11 }, 'P/b.txt': { lastModified: 22 } },
    });
    expect(mocks.toast).toHaveBeenCalledWith('Импортировано: 2', 'success');
  });

  it('есть совпадения - диалог с данными обеих сторон, решение уходит в manifest', async () => {
    mocks.planImport.mockResolvedValue({
      conflicts: [{ path: 'a.txt', existing: makeEntry({ size: 9, modifiedAt: 500, sourceModifiedAt: 300 }) }],
      newFiles: 1,
    });
    mocks.importEntries.mockResolvedValue(result({ imported: 1, replaced: 1 }));
    const { result: hook, askConflicts, onBatchDone } = setup(() => Promise.resolve(new Map([['a.txt', 'replace']])));
    act(() => hook.current.enqueue([file('a.txt', undefined, 11), file('new.txt', undefined, 22)], null));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    expect(askConflicts).toHaveBeenCalledWith({
      kind: 'import',
      items: [
        {
          key: 'a.txt',
          name: 'a.txt',
          incoming: { folder: false, size: 4, modifiedAt: 11 },
          existing: { folder: false, size: 9, modifiedAt: 300 },
        },
      ],
    });
    const [, sent, opts] = uploaded();
    expect(sent).toHaveLength(2);
    expect(opts.manifest.files).toEqual({
      'a.txt': { lastModified: 11, onConflict: 'replace' },
      'new.txt': { lastModified: 22 },
    });
    expect(mocks.toast).toHaveBeenCalledWith('Импортировано: 1, заменено: 1', 'success');
  });

  it('пропущенные файлы на сервер не передаются', async () => {
    mocks.planImport.mockResolvedValue({
      conflicts: [
        { path: 'a.txt', existing: makeEntry() },
        { path: 'b.txt', existing: makeEntry() },
      ],
      newFiles: 1,
    });
    mocks.importEntries.mockResolvedValue(result({ imported: 1 }));
    const { result: hook, onBatchDone } = setup(() =>
      Promise.resolve(
        new Map([
          ['a.txt', 'skip'],
          ['b.txt', 'keepBoth'],
        ] as const),
      ),
    );
    act(() => hook.current.enqueue([file('a.txt'), file('b.txt'), file('c.txt')], null));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    const [, sent, opts] = uploaded();
    expect(sent.map((f) => f.name)).toEqual(['b.txt', 'c.txt']);
    expect(Object.keys(opts.manifest.files)).toEqual(['b.txt', 'c.txt']);
    expect(opts.manifest.files['b.txt']?.onConflict).toBe('keepBoth');
    expect(mocks.toast).toHaveBeenCalledWith('Импортировано: 1, пропущено: 1', 'success');
  });

  it('всё пропущено - загрузки нет вовсе', async () => {
    mocks.planImport.mockResolvedValue({ conflicts: [{ path: 'a.txt', existing: makeEntry() }], newFiles: 0 });
    const { result: hook, onBatchDone } = setup(() => Promise.resolve(new Map([['a.txt', 'skip']] as const)));
    act(() => hook.current.enqueue([file('a.txt')], null));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    expect(mocks.importEntries).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('Пропущено: 1', 'info');
  });

  it('закрытие диалога отменяет весь импорт: ничего не загружается', async () => {
    mocks.planImport.mockResolvedValue({ conflicts: [{ path: 'a.txt', existing: makeEntry() }], newFiles: 1 });
    const { result: hook, onBatchDone } = setup(() => Promise.resolve(null));
    act(() => hook.current.enqueue([file('a.txt'), file('b.txt')], null));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    expect(mocks.importEntries).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('Импорт отменён', 'info');
  });

  it('ошибка плана - тост с сообщением сервера, байты не отправляются', async () => {
    mocks.planImport.mockRejectedValue(new ApiRequestError(422, 'invalid_argument', 'Слишком много файлов'));
    const { result: hook, onBatchDone } = setup();
    act(() => hook.current.enqueue([file('a.txt')], null));

    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    expect(mocks.importEntries).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('Слишком много файлов', 'error');
  });

  it('партии идут по одной: вторая ждёт решения по первой', async () => {
    let answer: (r: Resolutions | null) => void = () => undefined;
    mocks.planImport
      .mockResolvedValueOnce({ conflicts: [{ path: 'a.txt', existing: makeEntry() }], newFiles: 0 })
      .mockResolvedValueOnce(noConflicts);
    mocks.importEntries.mockResolvedValue(result({ imported: 1 }));
    const { result: hook, askConflicts } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    act(() => {
      hook.current.enqueue([file('a.txt')], null);
      hook.current.enqueue([file('b.txt')], null);
    });

    await waitFor(() => expect(askConflicts).toHaveBeenCalledOnce());
    expect(mocks.planImport).toHaveBeenCalledOnce(); // вторая партия ещё не сверялась
    expect(hook.current.progress?.phase).toBe('deciding');
    act(() => answer(new Map([['a.txt', 'replace']] as const)));

    await waitFor(() => expect(mocks.importEntries).toHaveBeenCalledTimes(2));
    expect(mocks.planImport).toHaveBeenCalledTimes(2);
  });
});
