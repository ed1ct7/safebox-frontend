import { describe, expect, it } from 'vitest';
import type { PendingFile } from '../api/endpoints';
import { makeEntry } from '../test/factories';
import {
  conflictTitle,
  importConflictItems,
  moveConflictItems,
  policyOfChoice,
  resolutionsFromChoices,
  resolutionsToRecord,
  sideOfEntry,
  uniformResolutions,
  unresolvedCount,
} from './conflicts';
import type { Choice, ConflictItem } from './conflicts';

const item = (key: string): ConflictItem => ({
  key,
  name: key,
  incoming: { folder: false, size: 1, modifiedAt: 1 },
  existing: { folder: false, size: 2, modifiedAt: 2 },
});

describe('policyOfChoice', () => {
  it('только «приходящий» - заменить, только «лежащий» - пропустить, оба - оставить оба', () => {
    expect(policyOfChoice({ incoming: true, existing: false })).toBe('replace');
    expect(policyOfChoice({ incoming: false, existing: true })).toBe('skip');
    expect(policyOfChoice({ incoming: true, existing: true })).toBe('keepBoth');
  });

  it('ни одной галочки - решения нет', () => {
    expect(policyOfChoice({ incoming: false, existing: false })).toBeNull();
  });
});

describe('решения по файлам', () => {
  const items = [item('a'), item('b'), item('c')];
  const choices = (entries: [string, Choice][]) => new Map(entries);
  const both: Choice = { incoming: true, existing: true };
  const none: Choice = { incoming: false, existing: false };

  it('«Заменить» и «Пропустить» - одно решение на всё', () => {
    expect([...uniformResolutions(items, 'replace')]).toEqual([
      ['a', 'replace'],
      ['b', 'replace'],
      ['c', 'replace'],
    ]);
    expect(uniformResolutions(items, 'skip').get('b')).toBe('skip');
  });

  it('все решены - карта решений в порядке списка', () => {
    const r = resolutionsFromChoices(
      items,
      choices([
        ['a', { incoming: true, existing: false }],
        ['b', { incoming: false, existing: true }],
        ['c', both],
      ]),
    );
    expect(r === null ? null : [...r]).toEqual([
      ['a', 'replace'],
      ['b', 'skip'],
      ['c', 'keepBoth'],
    ]);
  });

  it('есть файл без галочек или без записи - продолжать нельзя', () => {
    expect(resolutionsFromChoices(items, choices([['a', both], ['b', both]]))).toBeNull();
    expect(resolutionsFromChoices(items, choices([['a', both], ['b', both], ['c', none]]))).toBeNull();
  });

  it('счётчик нерешённых', () => {
    expect(unresolvedCount(items, choices([]))).toBe(3);
    expect(unresolvedCount(items, choices([['a', both], ['b', none]]))).toBe(2);
    expect(unresolvedCount(items, choices([['a', both], ['b', both], ['c', both]]))).toBe(0);
  });

  it('тело запроса перемещения - объект id -> решение', () => {
    expect(resolutionsToRecord(new Map([['5', 'skip'], ['7', 'replace']]))).toEqual({
      '5': 'skip',
      '7': 'replace',
    });
  });
});

describe('conflictTitle', () => {
  it('файлы: число и согласование', () => {
    expect(conflictTitle('import', 1)).toBe('В папке уже есть 1 файл с таким же именем');
    expect(conflictTitle('import', 2)).toBe('В папке уже есть 2 файла с такими же именами');
    expect(conflictTitle('import', 5)).toBe('В папке уже есть 5 файлов с такими же именами');
    expect(conflictTitle('import', 11)).toBe('В папке уже есть 11 файлов с такими же именами');
    expect(conflictTitle('import', 21)).toBe('В папке уже есть 21 файл с такими же именами');
  });

  it('перемещение говорит о записях', () => {
    expect(conflictTitle('move', 3)).toBe('В папке уже есть 3 записи с такими же именами');
  });
});

describe('sideOfEntry', () => {
  it('у записи сейфа - дата изменения исходного файла, если известна', () => {
    expect(sideOfEntry(makeEntry({ size: 10, modifiedAt: 500, sourceModifiedAt: 100 }))).toEqual({
      folder: false,
      size: 10,
      modifiedAt: 100,
    });
    expect(sideOfEntry(makeEntry({ size: 10, modifiedAt: 500, sourceModifiedAt: null })).modifiedAt).toBe(500);
  });

  it('папка - без размера', () => {
    expect(sideOfEntry(makeEntry({ kind: 'folder', modifiedAt: 5 }))).toEqual({
      folder: true,
      size: null,
      modifiedAt: 5,
    });
  });
});

describe('importConflictItems', () => {
  it('приходящая сторона - размер и дата самого файла, лежащая - запись сейфа', () => {
    const f = new File(['12345'], 'a.txt', { lastModified: 4242 }) as PendingFile;
    f.relativePath = 'P/a.txt';
    const items = importConflictItems(
      [{ path: 'P/a.txt', existing: makeEntry({ id: 9, size: 3, modifiedAt: 50, sourceModifiedAt: 40 }) }],
      [new File(['z'], 'other.txt') as PendingFile, f],
    );
    expect(items).toEqual([
      {
        key: 'P/a.txt',
        name: 'P/a.txt',
        incoming: { folder: false, size: 5, modifiedAt: 4242 },
        existing: { folder: false, size: 3, modifiedAt: 40 },
      },
    ]);
  });

  it('файла нет среди партии - неизвестные размер и дата, а не падение', () => {
    const [i] = importConflictItems([{ path: 'x.txt', existing: makeEntry() }], []);
    expect(i?.incoming).toEqual({ folder: false, size: null, modifiedAt: null });
  });
});

describe('moveConflictItems', () => {
  it('ключ - id перемещаемой записи, имя - её собственное', () => {
    const moving = makeEntry({ id: 3, name: 'фото.jpg', size: 9, modifiedAt: 70, sourceModifiedAt: 60 });
    const items = moveConflictItems(
      [{ id: 3, existing: makeEntry({ id: 8, name: 'фото.jpg', size: 4, modifiedAt: 20 }) }],
      [moving],
    );
    expect(items).toEqual([
      {
        key: '3',
        name: 'фото.jpg',
        incoming: { folder: false, size: 9, modifiedAt: 60 },
        existing: { folder: false, size: 4, modifiedAt: 20 },
      },
    ]);
  });
});
