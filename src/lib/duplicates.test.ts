import { describe, expect, it } from 'vitest';
import { filterDuplicates, isDuplicateLink } from './duplicates';
import type { PendingFile } from '../api/endpoints';
import type { Entry } from '../api/types';

const file = (name: string, size: number, relativePath?: string): PendingFile =>
  ({ name, size, lastModified: 1, type: '', relativePath }) as unknown as PendingFile;

const entry = (name: string, size: number): Entry =>
  ({
    id: 1,
    parentId: null,
    kind: 'file',
    name,
    size,
    mime: '',
    hasThumbnail: false,
    createdAt: 0,
    modifiedAt: 0,
  }) as Entry;

describe('filterDuplicates', () => {
  it('то же имя и размер — отсеивается', () => {
    const r = filterDuplicates([file('фото.jpg', 100)], [entry('фото.jpg', 100)]);
    expect(r.files).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('то же имя, но другой размер (изменённый файл) — проходит', () => {
    const r = filterDuplicates([file('фото.jpg', 200)], [entry('фото.jpg', 100)]);
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toBe(0);
  });

  it('дубли внутри одной партии отсеиваются до второго экземпляра', () => {
    const r = filterDuplicates([file('a.png', 5), file('a.png', 5), file('b.png', 7)], []);
    expect(r.files.map((f) => f.name)).toEqual(['a.png', 'b.png']);
    expect(r.skipped).toBe(1);
  });

  it('вложенный путь не сравнивается с корнем (файл уйдёт в подпапку)', () => {
    const r = filterDuplicates([file('a.png', 5, 'Фото/a.png')], [entry('a.png', 5)]);
    expect(r.files).toHaveLength(1);
  });

  it('одинаковые вложенные пути в партии — дубликат', () => {
    const r = filterDuplicates(
      [file('a.png', 5, 'Фото/a.png'), file('a.png', 5, 'Фото/a.png')],
      [],
    );
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it('пустая папка — всё проходит', () => {
    const r = filterDuplicates([file('a', 1), file('b', 2)], []);
    expect(r.files).toHaveLength(2);
  });
});

describe('isDuplicateLink', () => {
  const link = (url: string): Entry =>
    ({ ...entry('linqtab.com.url', 40), kind: 'link', url, domain: 'linqtab.com' });

  it('та же страница (тот же URL) — дубликат', () => {
    const existing: Entry[] = [link('https://linqtab.com/docs')];
    expect(isDuplicateLink(existing, 'https://linqtab.com/docs')).toBe(true);
    expect(isDuplicateLink(existing, '  https://linqtab.com/docs  ')).toBe(true);
  });

  it('другая страница того же сайта — не дубликат', () => {
    const existing: Entry[] = [link('https://linqtab.com/docs')];
    expect(isDuplicateLink(existing, 'https://linqtab.com/blog')).toBe(false);
    expect(isDuplicateLink(existing, 'https://gitlab.com')).toBe(false);
  });
});
