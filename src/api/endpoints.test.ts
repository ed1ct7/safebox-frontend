import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from './client';
import {
  assignTags,
  attachmentsZipUrlOf,
  buildImportForm,
  createLinks,
  createTag,
  downloadUrlOf,
  getEntry,
  getSettings,
  listEntries,
  moveEntries,
  planImport,
  planMove,
  refreshPreview,
  searchPath,
  updateEntry,
  updateSettings,
} from './endpoints';
import type { PendingFile } from './endpoints';
import { makeEntry } from '../test/factories';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

function stubFetch(status = 200, body: unknown = {}): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => setToken('t'));
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('записи', () => {
  it('листинг: любая запись - parentId в адресе, корень - без него', async () => {
    stubFetch();
    await listEntries(null);
    await listEntries(42);
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/entries', '/api/v1/entries?parentId=42']);
  });

  it('одна запись - GET /entries/:id', async () => {
    stubFetch(200, makeEntry({ id: 7 }));
    expect((await getEntry(7)).id).toBe(7);
    expect(calls[0]).toEqual({ url: '/api/v1/entries/7', method: 'GET', body: undefined });
  });

  it('PATCH передаёт только заданные поля', async () => {
    stubFetch();
    await updateEntry(7, { description: 'заметка' });
    expect(calls[0]).toEqual({
      url: '/api/v1/entries/7',
      method: 'PATCH',
      body: { description: 'заметка' },
    });
  });

  it('план перемещения и само перемещение', async () => {
    stubFetch();
    await planMove([1, 2], null);
    await moveEntries([1, 2], 9);
    await moveEntries([1, 2], 9, { '1': 'skip' });
    expect(calls[0]).toEqual({
      url: '/api/v1/entries/move/plan',
      method: 'POST',
      body: { ids: [1, 2], parentId: null },
    });
    expect(calls[1]?.body).toEqual({ ids: [1, 2], parentId: 9 }); // без решений поле не шлём
    expect(calls[2]?.body).toEqual({ ids: [1, 2], parentId: 9, resolutions: { '1': 'skip' } });
  });

  it('теги на записях: add и remove', async () => {
    stubFetch();
    await assignTags([1], { add: [{ tagId: 3, inherit: true }], remove: [4] });
    expect(calls[0]).toEqual({
      url: '/api/v1/entries/tags',
      method: 'POST',
      body: { ids: [1], add: [{ tagId: 3, inherit: true }], remove: [4] },
    });
  });
});

describe('searchPath', () => {
  it('только текст', () => {
    expect(searchPath('кот')).toBe('/api/v1/search?q=%D0%BA%D0%BE%D1%82');
  });

  it('теги, режим, область и лимит', () => {
    const path = searchPath('', { tags: [1, 2, 3], match: 'any', within: 5, limit: 50 });
    expect(path).toBe('/api/v1/search?q=&tags=1%2C2%2C3&match=any&within=5&limit=50');
  });

  it('пустой список тегов не попадает в адрес', () => {
    expect(searchPath('a', { tags: [] })).toBe('/api/v1/search?q=a');
  });
});

describe('теги', () => {
  it('201 - тег создан, 200 - уже был', async () => {
    stubFetch(201, { id: 1, categoryId: 2, name: 'ru' });
    await expect(createTag({ category: 'language', name: 'ru' })).resolves.toEqual({
      tag: { id: 1, categoryId: 2, name: 'ru' },
      created: true,
    });
    stubFetch(200, { id: 1, categoryId: 2, name: 'ru' });
    await expect(
      createTag({ category: 'language', name: 'ru', createCategory: true }),
    ).resolves.toMatchObject({ created: false });
    expect(calls[0]?.body).toEqual({ category: 'language', name: 'ru', createCategory: true });
  });
});

describe('ссылки и настройки', () => {
  it('создание ссылок и обновление предпросмотра', async () => {
    stubFetch();
    await createLinks(3, [{ url: 'https://a.com', path: 'Закладки' }]);
    await refreshPreview(11);
    expect(calls[0]).toEqual({
      url: '/api/v1/links',
      method: 'POST',
      body: { parentId: 3, links: [{ url: 'https://a.com', path: 'Закладки' }] },
    });
    expect(calls[1]).toMatchObject({ url: '/api/v1/entries/11/preview', method: 'POST' });
  });

  it('настройки', async () => {
    stubFetch(200, { linkPreviews: true });
    await getSettings();
    await updateSettings({ linkPreviews: false });
    expect(calls[0]).toMatchObject({ url: '/api/v1/settings', method: 'GET' });
    expect(calls[1]).toEqual({ url: '/api/v1/settings', method: 'PATCH', body: { linkPreviews: false } });
  });
});

describe('импорт', () => {
  const pending = (name: string, path?: string): PendingFile => {
    const f = new File(['data'], name) as PendingFile;
    if (path !== undefined) f.relativePath = path;
    return f;
  };

  it('план: parentId в адресе, пути и размеры в теле', async () => {
    stubFetch(200, { conflicts: [], newFiles: 1 });
    await planImport(12, [{ path: 'a.txt', size: 4 }]);
    await planImport(null, []);
    expect(calls[0]).toEqual({
      url: '/api/v1/import/plan?parentId=12',
      method: 'POST',
      body: { files: [{ path: 'a.txt', size: 4 }] },
    });
    expect(calls[1]?.url).toBe('/api/v1/import/plan');
  });

  it('manifest - первая часть и без filename, затем файлы под своими путями', () => {
    const fd = buildImportForm([pending('a.txt'), pending('b.jpg', 'Папка/b.jpg')], {
      files: { 'a.txt': { lastModified: 1 } },
    });
    const parts = [...fd.entries()];
    expect(parts.map(([name]) => name)).toEqual(['manifest', 'file', 'file']);
    const [manifest, first, second] = parts.map(([, value]) => value);
    expect(typeof manifest).toBe('string'); // строка: у Blob/File появился бы filename
    expect(JSON.parse(manifest as string)).toEqual({ files: { 'a.txt': { lastModified: 1 } } });
    expect((first as File).name).toBe('a.txt');
    expect((second as File).name).toBe('Папка/b.jpg');
  });

  it('без manifest - только файлы', () => {
    const fd = buildImportForm([pending('a.txt')]);
    expect([...fd.keys()]).toEqual(['file']);
  });
});

describe('скачивание', () => {
  it('«Скачать» у записи с вложениями - сам файл, вложения - отдельный zip', () => {
    const photo = makeEntry({ id: 5, kind: 'photo', childCount: 2 });
    expect(downloadUrlOf(photo)).toBe('/api/v1/media/5/download');
    expect(attachmentsZipUrlOf(photo)).toBe('/api/v1/media/5/zip');
  });

  it('без вложений zip не предлагается', () => {
    expect(attachmentsZipUrlOf(makeEntry({ kind: 'file', childCount: 0 }))).toBeNull();
  });

  it('у папки «Скачать» и есть zip, отдельных вложений нет', () => {
    const folder = makeEntry({ id: 6, kind: 'folder', childCount: 3 });
    expect(downloadUrlOf(folder)).toBe('/api/v1/media/6/zip');
    expect(attachmentsZipUrlOf(folder)).toBeNull();
  });

  it('ссылка скачивается ярлыком, вложения - zip', () => {
    const link = makeEntry({ id: 8, kind: 'link', url: 'https://a.com', childCount: 1 });
    expect(downloadUrlOf(link)).toBe('/api/v1/media/8/download');
    expect(attachmentsZipUrlOf(link)).toBe('/api/v1/media/8/zip');
  });
});
