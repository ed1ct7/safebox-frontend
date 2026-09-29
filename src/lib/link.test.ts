import { describe, expect, it } from 'vitest';
import {
  displayName,
  isDuplicateLink,
  isHttpUrl,
  linkNameFromUrl,
  makeUrlShortcut,
  uniqueLinkFileName,
} from './link';
import type { Entry } from '../api/types';

const entry = (name: string, extra: Partial<Entry> = {}): Entry => ({
  id: 1,
  parentId: null,
  kind: 'file',
  name,
  size: 40,
  mime: '',
  hasThumbnail: false,
  createdAt: 0,
  modifiedAt: 0,
  ...extra,
});

const link = (name: string, url: string): Entry =>
  entry(name, { kind: 'link', url, domain: new URL(url).hostname });

describe('isHttpUrl', () => {
  it('принимает http/https с хостом', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://example.com/a/b?x=1')).toBe(true);
    expect(isHttpUrl('  https://example.com  ')).toBe(true);
    expect(isHttpUrl('http://localhost:5173')).toBe(true);
  });

  it('отклоняет остальное', () => {
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl('https://')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('C:\\Users\\me\\file.txt')).toBe(false);
  });
});

describe('linkNameFromUrl', () => {
  it('домен без www, если пути нет', () => {
    expect(linkNameFromUrl('https://www.example.com/')).toBe('example.com');
    expect(linkNameFromUrl('https://example.com?x=1')).toBe('example.com');
  });

  it('последний сегмент пути — подсказка', () => {
    expect(linkNameFromUrl('https://github.com/ed1ct7/safebox-backend')).toBe(
      'github.com — safebox-backend',
    );
    expect(linkNameFromUrl('https://ru.wikipedia.org/wiki/%D0%A1%D0%B5%D0%B9%D1%84')).toBe(
      'ru.wikipedia.org — Сейф',
    );
    expect(linkNameFromUrl('https://site.com/docs/index.html')).toBe('site.com — index');
  });

  it('запрещённые в именах символы вычищаются', () => {
    expect(linkNameFromUrl('https://a.com/x%3A%2Ay%7C')).toBe('a.com — x y');
  });

  it('некорректный URL — запасное имя', () => {
    expect(linkNameFromUrl('not a url')).toBe('Ссылка');
  });
});

describe('isDuplicateLink', () => {
  const existing = [link('linqtab.com — docs.url', 'https://linqtab.com/docs')];

  it('та же страница (тот же URL) — дубликат', () => {
    expect(isDuplicateLink(existing, 'https://linqtab.com/docs')).toBe(true);
    expect(isDuplicateLink(existing, '  https://linqtab.com/docs  ')).toBe(true);
  });

  it('другая страница того же сайта — не дубликат', () => {
    expect(isDuplicateLink(existing, 'https://linqtab.com/blog')).toBe(false);
  });

  it('файл с таким именем — не ссылка', () => {
    expect(isDuplicateLink([entry('x.url')], 'https://linqtab.com/docs')).toBe(false);
  });
});

describe('uniqueLinkFileName', () => {
  it('свободное имя — как есть', () => {
    expect(uniqueLinkFileName([], 'a.com')).toBe('a.com.url');
  });

  it('занятое (без учёта регистра) получает номер', () => {
    const existing = [entry('A.com.url'), entry('a.com (2).url')];
    expect(uniqueLinkFileName(existing, 'a.com')).toBe('a.com (3).url');
  });
});

describe('makeUrlShortcut', () => {
  it('синтезирует ярлык .url для импорта', async () => {
    const file = makeUrlShortcut('https://www.example.com/x', 'example.com — x.url');
    expect(file.name).toBe('example.com — x.url');
    // jsdom File не умеет .text() — читаем через FileReader
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(file);
    });
    expect(text).toBe('[InternetShortcut]\r\nURL=https://www.example.com/x\r\n');
  });
});

describe('displayName', () => {
  it('у ссылки скрывает .url, у файла — нет', () => {
    expect(displayName(link('a.com — x.url', 'https://a.com/x'))).toBe('a.com — x');
    expect(displayName(entry('ярлык.url'))).toBe('ярлык.url');
  });
});
