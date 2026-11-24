import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { hasPendingPreview, mergeListing, mergeSearch, nextOffset, patchCachedEntries } from './queries';
import type { Entry, Listing, SearchResponse } from './types';
import { makeEntry } from '../test/factories';

const link = (pending?: boolean): Entry => makeEntry({ kind: 'link', previewPending: pending });
const pages = <T,>(...p: T[]): InfiniteData<T, number> => ({ pages: p, pageParams: p.map((_, i) => i) });

describe('hasPendingPreview', () => {
  it('true только если у какой-то записи previewPending === true', () => {
    expect(hasPendingPreview([link(false), link(true)])).toBe(true);
    expect(hasPendingPreview([link(false), link()])).toBe(false);
    expect(hasPendingPreview([])).toBe(false);
    expect(hasPendingPreview(undefined)).toBe(false);
  });
});

describe('постраничная выдача (К2)', () => {
  it('следующая страница - пока загружено меньше total', () => {
    expect(nextOffset(200, 200, 60_000)).toBe(200);
    expect(nextOffset(60_000, 2000, 60_000)).toBeUndefined();
    expect(nextOffset(200, 200, undefined)).toBeUndefined(); // старый сервер без total отдал всё
    expect(nextOffset(150, 0, 60_000)).toBeUndefined(); // пустая страница - дальше нечего
  });

  const lst = (entries: Entry[], total?: number): Listing => ({ parent: null, path: [], entries, total });
  const [a, b, c, d] = [1, 2, 3, 4].map((id) => makeEntry({ id }));

  it('страницы склеиваются; «всё загружено» - когда нет следующей страницы', () => {
    const part = mergeListing(pages(lst([a!, b!], 4)));
    expect(part).toMatchObject({ total: 4, complete: false, stale: false });
    const full = mergeListing(pages(lst([a!, b!], 4), lst([c!, d!], 4)));
    expect(full.entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(full).toMatchObject({ total: 4, complete: true, stale: false });
    const found = mergeSearch(
      pages<SearchResponse>({ query: 'q', results: [{ entry: a!, path: [], matchedIn: 'name' }], total: 1 }),
    );
    expect(found).toMatchObject({ total: 1, complete: true, stale: false });
  });

  it('папка поменялась между страницами - выдача помечена устаревшей (перечитать)', () => {
    // перед стыком вставили запись: b съехала на вторую страницу и повторилась, новая не попала
    const inserted = mergeListing(pages(lst([a!, b!], 4), lst([b!, c!, d!], 5)));
    expect(inserted.entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(inserted).toMatchObject({ total: 5, complete: true, stale: true });
    // перед стыком удалили: c сдвинулась на первую страницу и пропущена
    const deleted = mergeListing(pages(lst([a!, b!], 4), lst([d!], 3)));
    expect(deleted).toMatchObject({ complete: true, stale: true });
    // страница пришла короче, чем обещал total
    expect(mergeListing(pages(lst([a!, b!], 4), lst([], 4)))).toMatchObject({ complete: true, stale: true });
  });

  it('точечное обновление подменяет запись во всех загруженных страницах', () => {
    const qc = new QueryClient();
    const a = makeEntry({ id: 1, name: 'старое' });
    const other = makeEntry({ id: 2 });
    qc.setQueryData(['listing', null], pages<Listing>({ parent: null, path: [], entries: [other] }, { parent: null, path: [], entries: [a] }));
    qc.setQueryData(['search', 'q', {}], pages<SearchResponse>({ query: 'q', results: [{ entry: a, path: [], matchedIn: 'name' }] }));
    const before = qc.getQueryData<InfiniteData<Listing, number>>(['listing', null]);
    patchCachedEntries(qc, [{ ...a, name: 'новое' }]);
    const after = qc.getQueryData<InfiniteData<Listing, number>>(['listing', null]);
    expect(after?.pages[1]?.entries[0]?.name).toBe('новое');
    expect(after?.pages[0]).toBe(before?.pages[0]); // нетронутая страница - тот же объект
    const search = qc.getQueryData<InfiniteData<SearchResponse, number>>(['search', 'q', {}]);
    expect(search?.pages[0]?.results[0]?.entry.name).toBe('новое');
  });
});
