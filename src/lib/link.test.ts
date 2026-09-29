import { describe, expect, it } from 'vitest';
import { displayName, isHttpUrl, parseUrlList } from './link';
import type { Entry } from '../api/types';
import { makeEntry } from '../test/factories';

const entry = (name: string, extra: Partial<Entry> = {}): Entry => makeEntry({ name, ...extra });

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

describe('parseUrlList (Ctrl+V и перетаскивание, UF-20)', () => {
  it('один адрес', () => {
    expect(parseUrlList('https://example.com/a')).toEqual({ urls: ['https://example.com/a'], invalid: 0 });
  });

  it('по строке на адрес, любые переводы строк', () => {
    const text = 'https://a.com\r\nhttp://b.org/x\rhttps://c.net\nhttps://d.io';
    expect(parseUrlList(text).urls).toEqual(['https://a.com', 'http://b.org/x', 'https://c.net', 'https://d.io']);
  });

  it('пробелы по краям и пустые строки игнорируются', () => {
    expect(parseUrlList('\n  https://a.com  \n\n   \t\n https://b.com\n\n')).toEqual({
      urls: ['https://a.com', 'https://b.com'],
      invalid: 0,
    });
  });

  it('некорректные строки считаются, корректные остаются', () => {
    const text = 'https://a.com\nпросто текст\nftp://x.org\njavascript:alert(1)\nhttps://b.com';
    expect(parseUrlList(text)).toEqual({ urls: ['https://a.com', 'https://b.com'], invalid: 3 });
  });

  it('только некорректное - адресов нет', () => {
    expect(parseUrlList('привет\nмир')).toEqual({ urls: [], invalid: 2 });
  });

  it('пустой текст - ни адресов, ни ошибок', () => {
    expect(parseUrlList('')).toEqual({ urls: [], invalid: 0 });
    expect(parseUrlList('  \n \r\n')).toEqual({ urls: [], invalid: 0 });
  });

  it('повтор той же строки уходит один раз', () => {
    expect(parseUrlList('https://a.com\nhttps://a.com\n https://a.com ').urls).toEqual(['https://a.com']);
  });
});

describe('displayName', () => {
  it('у ссылки скрывает .url, у файла - нет', () => {
    expect(displayName(link('a.com — x.url', 'https://a.com/x'))).toBe('a.com — x');
    expect(displayName(entry('ярлык.url'))).toBe('ярлык.url');
  });
});
