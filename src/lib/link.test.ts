import { describe, expect, it } from 'vitest';
import { isHttpUrl, linkNameFromUrl, makeUrlShortcut } from './link';

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
    expect(isHttpUrl('C:\\Users\\me\\file.txt')).toBe(false);
  });
});

describe('linkNameFromUrl', () => {
  it('домен без www и протокола', () => {
    expect(linkNameFromUrl('https://www.example.com/page?x=1')).toBe('example.com');
    expect(linkNameFromUrl('http://gitlab.linqtab.com/group/repo')).toBe('gitlab.linqtab.com');
  });

  it('некорректный URL — запасное имя', () => {
    expect(linkNameFromUrl('not a url')).toBe('Ссылка');
  });
});

describe('makeUrlShortcut', () => {
  it('синтезирует ярлык .url для импорта (контракт §7 api.md)', async () => {
    const file = makeUrlShortcut('https://www.example.com/x');
    expect(file.name).toBe('example.com.url');
    // jsdom File не умеет .text() — читаем через FileReader
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(file);
    });
    expect(text).toContain('[InternetShortcut]');
    expect(text).toContain('URL=https://www.example.com/x');
    expect(text).toContain('\r\n');
  });
});
