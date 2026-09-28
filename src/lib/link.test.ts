import { describe, expect, it } from 'vitest';
import { isHttpUrl, linkNameFromUrl, makeUrlShortcut } from './link';
import { validateEntryName } from './name';

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

describe('validateEntryName', () => {
  it('зеркалит правила сервера PATCH /entries/:id', () => {
    expect(validateEntryName('Фото 2024.jpg')).toBeNull();
    expect(validateEntryName('  ')).toBe('Имя не может быть пустым'); // trimmed наружи, но на всякий случай
    expect(validateEntryName('.')).not.toBeNull();
    expect(validateEntryName('..')).not.toBeNull();
    expect(validateEntryName('a/b')).not.toBeNull();
    expect(validateEntryName('a\\b')).not.toBeNull();
    expect(validateEntryName('a:b')).not.toBeNull();
    expect(validateEntryName('a*b?c"d<e>f|g')).not.toBeNull();
    expect(validateEntryName('a\u0001b')).not.toBeNull();
    expect(validateEntryName('д'.repeat(128))).not.toBeNull(); // 256 байт UTF-8 > 255
    expect(validateEntryName('д'.repeat(127))).toBeNull(); // 254 байта — ок
  });
});
