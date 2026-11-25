import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeTable, TEMPLATES } from '../lib/table';
import { makeEntry } from '../test/factories';
import type { ImportManifest, ImportResult } from './types';
import { createTable, loadTable, saveTableText, TableConflictError } from './tables';

// Таблица - обычный файл записи: читается через /media/:id/content, пишется импортом с
// заменой. Проверяется порядок действий при записи и то, что чужое не затирается.

const mocks = vi.hoisted(() => ({ getEntry: vi.fn(), planImport: vi.fn(), importEntries: vi.fn() }));

vi.mock('./endpoints', async (original) => ({
  ...(await original<typeof import('./endpoints')>()),
  getEntry: mocks.getEntry,
  planImport: mocks.planImport,
  importEntries: mocks.importEntries,
}));

const doc = TEMPLATES[0]!.make();
const text = serializeTable(doc);
const entry = makeEntry({ id: 7, parentId: 3, name: 'Пароли.sbtable', modifiedAt: 100 });
const result = (extra: Partial<ImportResult> = {}): ImportResult => ({
  imported: 0,
  replaced: 0,
  skipped: 0,
  failed: 0,
  failures: [],
  ...extra,
});

let content = text; // что «лежит в сейфе»
const fetchMock = vi.fn(async () => new Response(content, { status: 200 }));

const manifestOf = (call: number) => (mocks.importEntries.mock.calls[call]![2] as { manifest: ImportManifest }).manifest;

beforeEach(() => {
  content = text;
  vi.stubGlobal('fetch', fetchMock);
  mocks.getEntry.mockResolvedValue(entry);
  mocks.planImport.mockResolvedValue({ conflicts: [{ path: entry.name, existing: entry }], newFiles: 0 });
  mocks.importEntries.mockResolvedValue(result({ replaced: 1, importedFiles: [{ path: entry.name, id: 7 }] }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('loadTable', () => {
  it('запись, таблица и снимок того, что в сейфе', async () => {
    const loaded = await loadTable(7);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/7/content', { cache: 'no-store' });
    expect(loaded.entry).toBe(entry);
    expect(loaded.doc.columns.map((c) => c.name)).toEqual(doc.columns.map((c) => c.name));
    expect(loaded.base).toEqual({ text, modifiedAt: 100 });
  });

  it('в файле не таблица - ошибка с понятным текстом', async () => {
    content = 'просто текст';
    await expect(loadTable(7)).rejects.toThrow(/не таблица|повреждён/i);
  });

  it('файла нет - ошибка сервера', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'Запись не найдена' } }), { status: 404 }),
    );
    await expect(loadTable(7)).rejects.toThrow('Запись не найдена');
  });
});

describe('saveTableText', () => {
  it('запись не менялась: содержимое не перечитывается, файл заменяется под тем же именем', async () => {
    const fresh = { ...entry, modifiedAt: 200, size: 999 };
    mocks.getEntry.mockResolvedValueOnce(entry).mockResolvedValueOnce(fresh);

    const saved = await saveTableText(7, 'новый текст', { text, modifiedAt: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.planImport).toHaveBeenCalledWith(3, [{ path: 'Пароли.sbtable', size: new Blob(['новый текст']).size }]);
    const [parentId, files] = mocks.importEntries.mock.calls[0]! as [number, File[]];
    expect(parentId).toBe(3);
    expect(files.map((f) => f.name)).toEqual(['Пароли.sbtable']);
    // replace - содержимое меняется у той же записи; import - не пропускать как дубликат
    expect(manifestOf(0)).toEqual({ files: { 'Пароли.sbtable': { onConflict: 'replace', onDuplicate: 'import' } } });
    expect(saved).toEqual({ base: { text: 'новый текст', modifiedAt: 200 }, entry: fresh });
  });

  it('запись переименовали или перенесли: содержимое то же - пишем по новому месту', async () => {
    const renamed = { ...entry, name: 'Доступы.sbtable', parentId: 9, modifiedAt: 150 };
    mocks.getEntry.mockResolvedValue(renamed);
    mocks.planImport.mockResolvedValue({ conflicts: [{ path: renamed.name, existing: renamed }], newFiles: 0 });

    await saveTableText(7, 'новый текст', { text, modifiedAt: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.planImport).toHaveBeenCalledWith(9, [expect.objectContaining({ path: 'Доступы.sbtable' })]);
    expect(mocks.importEntries.mock.calls[0]![0]).toBe(9);
  });

  it('содержимое в сейфе уже другое - конфликт, ничего не пишется', async () => {
    mocks.getEntry.mockResolvedValue({ ...entry, modifiedAt: 150 });
    content = 'чужая правка';

    await expect(saveTableText(7, 'новый текст', { text, modifiedAt: 100 })).rejects.toBeInstanceOf(TableConflictError);
    expect(mocks.planImport).not.toHaveBeenCalled();
    expect(mocks.importEntries).not.toHaveBeenCalled();
  });

  it('force: своя версия пишется поверх чужой без сверки', async () => {
    mocks.getEntry.mockResolvedValue({ ...entry, modifiedAt: 150 });
    content = 'чужая правка';

    await saveTableText(7, 'новый текст', { text, modifiedAt: 100 }, { force: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.importEntries).toHaveBeenCalledTimes(1);
  });

  it('имя в папке занято другой записью - отказ: замена задела бы чужой файл', async () => {
    mocks.planImport.mockResolvedValue({
      conflicts: [{ path: entry.name, existing: { ...entry, id: 8 } }],
      newFiles: 0,
    });

    await expect(saveTableText(7, 'новый текст', { text, modifiedAt: 100 })).rejects.toThrow(/ещё одна запись/);
    expect(mocks.importEntries).not.toHaveBeenCalled();
  });

  it('записи с этим именем в папке нет - отказ: импорт создал бы вторую таблицу', async () => {
    mocks.planImport.mockResolvedValue({ conflicts: [], newFiles: 1 });

    await expect(saveTableText(7, 'новый текст', { text, modifiedAt: 100 })).rejects.toThrow(/удалена или перемещена/);
    expect(mocks.importEntries).not.toHaveBeenCalled();
  });

  it('сервер не заменил файл - ошибка с его объяснением', async () => {
    mocks.importEntries.mockResolvedValue(
      result({ failed: 1, failures: [{ path: entry.name, message: 'Нет места на диске' }] }),
    );

    await expect(saveTableText(7, 'новый текст', { text, modifiedAt: 100 })).rejects.toThrow('Нет места на диске');
  });
});

describe('createTable', () => {
  it('файл «имя.sbtable» в папке; занятое имя не заменяется; id новой записи', async () => {
    mocks.importEntries.mockResolvedValue(result({ imported: 1, importedFiles: [{ path: 'Карты.sbtable', id: 42 }] }));

    await expect(createTable(3, 'Карты', doc)).resolves.toBe(42);

    const [parentId, files] = mocks.importEntries.mock.calls[0]! as [number, File[]];
    expect(parentId).toBe(3);
    expect(files.map((f) => f.name)).toEqual(['Карты.sbtable']);
    expect(manifestOf(0)).toEqual({ files: { 'Карты.sbtable': { onConflict: 'keepBoth', onDuplicate: 'import' } } });
  });

  it('старый сервер не сообщает id - null', async () => {
    mocks.importEntries.mockResolvedValue(result({ imported: 1 }));
    await expect(createTable(null, 'Карты', doc)).resolves.toBeNull();
  });

  it('ничего не записано - ошибка', async () => {
    mocks.importEntries.mockResolvedValue(result({ skipped: 1 }));
    await expect(createTable(null, 'Карты', doc)).rejects.toThrow('Не удалось создать таблицу');
  });
});
