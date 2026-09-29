import { describe, expect, it } from 'vitest';
import { hasPendingPreview, listingQuery, PREVIEW_POLL_MS, searchQuery } from './queries';
import type { Entry, Listing, SearchResponse } from './types';
import { makeEntry } from '../test/factories';

// Опрос листинга, пока у ссылок грузится предпросмотр (UF-21): интервал считается из данных.

const link = (pending?: boolean): Entry => makeEntry({ kind: 'link', previewPending: pending });
const listing = (...entries: Entry[]): Listing => ({ parent: null, path: [], entries });

/** refetchInterval запроса, как его вызывает TanStack Query: с текущими данными. */
function intervalOf(options: { refetchInterval?: unknown }, data: unknown): unknown {
  const fn = options.refetchInterval;
  if (typeof fn !== 'function') throw new Error('refetchInterval должен считаться по данным');
  return fn({ state: { data } });
}

describe('hasPendingPreview', () => {
  it('true только если у какой-то записи previewPending === true', () => {
    expect(hasPendingPreview([link(false), link(true)])).toBe(true);
    expect(hasPendingPreview([link(false), link()])).toBe(false);
    expect(hasPendingPreview([])).toBe(false);
    expect(hasPendingPreview(undefined)).toBe(false);
  });
});

describe('listingQuery: опрос', () => {
  const options = listingQuery(null);

  it('пока есть ожидающие - раз в 2 секунды', () => {
    expect(PREVIEW_POLL_MS).toBe(2000);
    expect(intervalOf(options, listing(link(true)))).toBe(2000);
  });

  it('ожидающих нет или данных ещё нет - опроса нет', () => {
    expect(intervalOf(options, listing(link(false), link()))).toBe(false);
    expect(intervalOf(options, undefined)).toBe(false);
  });
});

describe('searchQuery: опрос', () => {
  const options = searchQuery('q');
  const reply = (...entries: Entry[]): SearchResponse => ({
    query: 'q',
    results: entries.map((entry) => ({ entry, path: [], matchedIn: 'name' as const })),
  });

  it('в результатах есть ожидающие - опрос, нет - тишина', () => {
    expect(intervalOf(options, reply(link(true)))).toBe(2000);
    expect(intervalOf(options, reply(link(false)))).toBe(false);
    expect(intervalOf(options, undefined)).toBe(false);
  });
});
