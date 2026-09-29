import { describe, expect, it } from 'vitest';
import type { CreateLinksResponse, ImportResult } from '../api/types';
import {
  bookmarksSummary,
  deleteWarning,
  firstLine,
  formatBytes,
  formatDateTime,
  importSummary,
  linksSummary,
  moveSummary,
  plural,
} from './format';
import { makeEntry } from '../test/factories';

describe('formatBytes', () => {
  it('байты без дробей', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1023)).toBe('1023 Б');
  });

  it('килобайты и мегабайты с одной цифрой после точки', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8.0 МБ');
  });

  it('крупные значения округляются', () => {
    expect(formatBytes(123 * 1024 * 1024)).toBe('123 МБ');
  });

  it('гигабайты и терабайты', () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 ГБ');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 ТБ');
  });
});

describe('formatDateTime', () => {
  it('дд.ММ.гггг чч:мм из локального времени', () => {
    const ms = new Date(2024, 0, 2, 9, 5).getTime();
    expect(formatDateTime(ms)).toBe('02.01.2024 09:05');
  });
});

describe('plural', () => {
  it('русские формы', () => {
    expect(plural(1, 'объект', 'объекта', 'объектов')).toBe('1 объект');
    expect(plural(2, 'объект', 'объекта', 'объектов')).toBe('2 объекта');
    expect(plural(5, 'объект', 'объекта', 'объектов')).toBe('5 объектов');
    expect(plural(11, 'объект', 'объекта', 'объектов')).toBe('11 объектов');
    expect(plural(21, 'объект', 'объекта', 'объектов')).toBe('21 объект');
  });
});

describe('importSummary', () => {
  const r = (imported: number, extra: Partial<ImportResult> = {}): ImportResult => ({
    imported,
    replaced: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    ...extra,
  });
  const broken = { failed: 1, failures: [{ path: 'Папка/битый.jpg', message: 'Ошибка записи' }] };

  it('обычный импорт', () => {
    expect(importSummary(r(3))).toEqual({ text: 'Импортировано: 3', kind: 'success' });
  });

  it('заменено и пропущено - в одном тосте', () => {
    expect(importSummary(r(5, { replaced: 2, skipped: 1 }))).toEqual({
      text: 'Импортировано: 5, заменено: 2, пропущено: 1',
      kind: 'success',
    });
  });

  it('файлы, от которых отказались в диалоге, добавляются к пропущенным сервером', () => {
    expect(importSummary(r(1, { skipped: 1 }), undefined, 3).text).toBe('Импортировано: 1, пропущено: 4');
  });

  it('ошибки - в конце, первая подробно', () => {
    const s = importSummary(r(2, { ...broken, skipped: 4 }), 'Загрузки');
    expect(s.kind).toBe('error');
    expect(s.text).toBe(
      'Импортировано из «Загрузки»: 2, пропущено: 4, ошибок: 1\nПапка/битый.jpg: Ошибка записи',
    );
  });

  it('всё пропущено пользователем - на сервер ничего не ушло', () => {
    expect(importSummary(r(0), undefined, 5)).toEqual({ text: 'Пропущено: 5', kind: 'info' });
  });

  it('только замены - тоже итог, а не «нечего импортировать»', () => {
    expect(importSummary(r(0, { replaced: 2 })).text).toBe('Импортировано: 0, заменено: 2');
  });

  it('нечего импортировать', () => {
    expect(importSummary(r(0))).toEqual({ text: 'Нечего импортировать', kind: 'info' });
  });
});

describe('moveSummary', () => {
  it('перемещено, заменено, пропущено', () => {
    expect(moveSummary({ moved: 3, replaced: 1, skipped: 2 })).toEqual({
      text: 'Перемещено: 3, заменено: 1, пропущено: 2',
      kind: 'success',
    });
    expect(moveSummary({ moved: 1, replaced: 0, skipped: 0 }).text).toBe('Перемещено: 1');
  });

  it('всё пропущено или ничего не изменилось - информация, не успех', () => {
    expect(moveSummary({ moved: 0, replaced: 0, skipped: 2 })).toEqual({
      text: 'Пропущено: 2',
      kind: 'info',
    });
    expect(moveSummary({ moved: 0, replaced: 0, skipped: 0 }).kind).toBe('info');
  });
});

describe('linksSummary (UF-20)', () => {
  const made = (id: number) => makeEntry({ id, kind: 'link', url: `https://a.com/${id}` });
  const reply = (r: Partial<CreateLinksResponse>): CreateLinksResponse => ({
    created: [],
    existing: [],
    invalid: [],
    ...r,
  });

  it('одна созданная - «Ссылка добавлена»', () => {
    expect(linksSummary(reply({ created: [made(1)] }))).toEqual([{ text: 'Ссылка добавлена', kind: 'success' }]);
  });

  it('несколько созданных - число', () => {
    expect(linksSummary(reply({ created: [made(1), made(2), made(3)] }))).toEqual([
      { text: 'Добавлено ссылок: 3', kind: 'success' },
    ]);
  });

  it('уже есть одна - «Уже есть» и переход к ней', () => {
    expect(linksSummary(reply({ existing: [{ url: 'https://a.com/', entryId: 7 }] }))).toEqual([
      { text: 'Уже есть', kind: 'info', showId: 7 },
    ]);
  });

  it('уже есть несколько - число, «Показать» открывает первую', () => {
    const existing = [
      { url: 'https://a.com/', entryId: 7 },
      { url: 'https://b.com/', entryId: 8 },
    ];
    expect(linksSummary(reply({ existing }))).toEqual([{ text: 'Уже есть: 2', kind: 'info', showId: 7 }]);
  });

  it('создано и уже было: одна знакомая ссылка - есть куда перейти, несколько - нет', () => {
    const one = linksSummary(reply({ created: [made(1)], existing: [{ url: 'https://a.com/', entryId: 7 }] }));
    expect(one).toEqual([{ text: 'Добавлено ссылок: 1, уже было: 1', kind: 'success', showId: 7 }]);
    const two = linksSummary(
      reply({
        created: [made(1)],
        existing: [
          { url: 'https://a.com/', entryId: 7 },
          { url: 'https://b.com/', entryId: 8 },
        ],
      }),
    );
    expect(two[0]?.showId).toBeUndefined();
  });

  it('всё некорректное - «Это не ссылка»', () => {
    expect(linksSummary(reply({}), 2)).toEqual([{ text: 'Это не ссылка', kind: 'error' }]);
    expect(linksSummary(reply({ invalid: ['https://'] }))).toEqual([{ text: 'Это не ссылка', kind: 'error' }]);
  });

  it('часть некорректных - отдельный тост с числом (до запроса и после)', () => {
    expect(linksSummary(reply({ created: [made(1)], invalid: ['https://'] }), 2)).toEqual([
      { text: 'Ссылка добавлена', kind: 'success' },
      { text: 'Пропущено некорректных: 3', kind: 'info' },
    ]);
  });
});

describe('bookmarksSummary (UF-20)', () => {
  it('создано, уже было, некорректных', () => {
    expect(bookmarksSummary({ created: 120, existing: 5, invalid: 2 })).toEqual({
      text: 'Закладки: создано 120, уже было 5, некорректных 2',
      kind: 'success',
    });
  });

  it('нулевые части не пишутся', () => {
    expect(bookmarksSummary({ created: 3, existing: 0, invalid: 0 }).text).toBe('Закладки: создано 3');
  });

  it('ничего не создано, всё уже было - тоже успех', () => {
    expect(bookmarksSummary({ created: 0, existing: 4, invalid: 0 })).toEqual({
      text: 'Закладки: создано 0, уже было 4',
      kind: 'success',
    });
  });

  it('одни некорректные - не успех', () => {
    expect(bookmarksSummary({ created: 0, existing: 0, invalid: 3 }).kind).toBe('info');
  });

  it('в файле ничего нет', () => {
    expect(bookmarksSummary({ created: 0, existing: 0, invalid: 0 })).toEqual({
      text: 'В файле нет закладок',
      kind: 'info',
    });
  });
});

describe('deleteWarning', () => {
  const folder = { kind: 'folder', childCount: 0 } as const;
  const photo = { kind: 'photo', childCount: 0 } as const;
  const photoWithAttachments = { kind: 'photo', childCount: 2 } as const;

  it('нечего предупреждать - пусто', () => {
    expect(deleteWarning([photo])).toBe('');
  });

  it('папка, вложения или и то и другое', () => {
    expect(deleteWarning([folder])).toBe('Папки удаляются вместе со всем содержимым.\n');
    expect(deleteWarning([photoWithAttachments])).toBe('Записи с вложениями удаляются вместе с вложениями.\n');
    expect(deleteWarning([folder, photoWithAttachments, photo])).toBe(
      'Папки и записи с вложениями удаляются вместе со всем содержимым.\n',
    );
  });
});

describe('firstLine', () => {
  it('первая непустая строка без пробелов по краям', () => {
    expect(firstLine('Заметка\nвторая')).toBe('Заметка');
    expect(firstLine('\r\n  \n  Вторая строка  \r\nтретья')).toBe('Вторая строка');
  });

  it('пустое описание - пусто', () => {
    expect(firstLine('')).toBe('');
    expect(firstLine(' \n \n')).toBe('');
  });
});
