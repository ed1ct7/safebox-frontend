import { describe, expect, it } from 'vitest';
import { dragKind, linkTextFromDataTransfer, pastedFile } from './dnd';
import { DRAG_MIME } from './move';

describe('dragKind: карточка, файлы или ссылка (UF-20)', () => {
  it('карточки сейфа определяются по своему типу', () => {
    expect(dragKind([DRAG_MIME])).toBe('entries');
  });

  it('файлы из проводника - Files', () => {
    expect(dragKind(['Files'])).toBe('files');
  });

  it('ссылка из браузера - text/uri-list и/или text/plain', () => {
    expect(dragKind(['text/uri-list', 'text/plain'])).toBe('link');
    expect(dragKind(['text/plain'])).toBe('link');
    expect(dragKind(['text/html', 'text/uri-list'])).toBe('link');
  });

  it('файл сильнее адреса: картинка со страницы несёт и то и другое', () => {
    expect(dragKind(['text/uri-list', 'text/html', 'Files'])).toBe('files');
  });

  it('карточка сильнее всего остального', () => {
    expect(dragKind(['text/plain', 'Files', DRAG_MIME])).toBe('entries');
  });

  it('остальное - не наше', () => {
    expect(dragKind([])).toBeNull();
    expect(dragKind(['text/html'])).toBeNull();
  });
});

describe('linkTextFromDataTransfer', () => {
  const dt = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? '' });

  it('text/uri-list в приоритете', () => {
    const text = linkTextFromDataTransfer(
      dt({ 'text/uri-list': 'https://a.com/\r\n', 'text/plain': 'что-то другое' }),
    );
    expect(text.trim()).toBe('https://a.com/');
  });

  it('строки-комментарии uri-list пропускаются', () => {
    const list = '# Ссылки из браузера\r\nhttps://a.com\r\n  # ещё комментарий\r\nhttps://b.com';
    expect(linkTextFromDataTransfer(dt({ 'text/uri-list': list }))).toBe('https://a.com\nhttps://b.com');
  });

  it('в uri-list одни комментарии - берём text/plain', () => {
    const text = linkTextFromDataTransfer(dt({ 'text/uri-list': '# только комментарий', 'text/plain': 'https://c.com' }));
    expect(text).toBe('https://c.com');
  });

  it('нет uri-list - text/plain', () => {
    expect(linkTextFromDataTransfer(dt({ 'text/plain': 'https://d.com' }))).toBe('https://d.com');
  });

  it('пусто - пустая строка', () => {
    expect(linkTextFromDataTransfer(dt({}))).toBe('');
  });
});

describe('pastedFile (Ctrl+V картинки из браузера)', () => {
  it('безликое image.png получает имя с датой', () => {
    const src = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const out = pastedFile(src);
    expect(out.name).toMatch(/^Вставлено \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/);
    expect(out.type).toBe('image/png');
  });

  it('jpeg → jpg, содержимое сохраняется', async () => {
    const src = new File([new Uint8Array([9, 9])], 'image.jpeg', { type: 'image/jpeg' });
    const out = pastedFile(src);
    expect(out.name.endsWith('.jpg')).toBe(true);
    expect(out.size).toBe(2);
  });

  it('именной файл не переименовывается', () => {
    const src = new File([new Uint8Array([1])], 'отчёт.png', { type: 'image/png' });
    expect(pastedFile(src).name).toBe('отчёт.png');
  });

  it('не-картинка не переименовывается', () => {
    const src = new File([new Uint8Array([1])], 'unknown', { type: 'text/plain' });
    expect(pastedFile(src).name).toBe('unknown');
  });
});
