import { describe, expect, it } from 'vitest';
import { chunk, parseBookmarks } from './bookmarks';
import chromeExport from './fixtures/chrome-bookmarks.html?raw';
import firefoxExport from './fixtures/firefox-bookmarks.html?raw';

// Настоящие форматы экспорта: Chrome/Edge («Bookmarks bar») и Firefox (русская локаль).

describe('parseBookmarks: экспорт Chrome', () => {
  const { links, skipped } = parseBookmarks(chromeExport);

  it('папки становятся путём, закладки - ссылками в порядке файла', () => {
    expect(links).toEqual([
      { url: 'https://github.com/ed1ct7', name: 'ed1ct7 (Ed) · GitHub', path: 'Bookmarks bar' },
      { url: 'https://example.com/docs?a=1&b=2', name: 'Docs API v2', path: 'Bookmarks bar/Работа' },
      { url: 'https://old.example.org/', name: 'Старый сайт', path: 'Bookmarks bar/Работа/Архив' },
      { url: 'https://example.com/no-title', path: 'Bookmarks bar/Работа' },
      { url: 'https://news.example.net/', name: 'Новости', path: 'Bookmarks bar' },
      { url: 'https://ru.wikipedia.org/wiki/%D0%A1%D0%B5%D0%B9%D1%84', name: 'Сейф — Википедия', path: 'Other bookmarks' },
    ]);
  });

  it('javascript:, chrome:// и пустой адрес пропускаются и считаются', () => {
    expect(skipped).toBe(3);
    expect(links.some((l) => /^(javascript|chrome):/.test(l.url))).toBe(false);
  });

  it('название, совпадающее с адресом, имени не даёт: его подставит сейф', () => {
    expect(links.find((l) => l.url === 'https://example.com/no-title')).not.toHaveProperty('name');
  });

  it('пустая папка ничего не создаёт', () => {
    expect(links.some((l) => l.path?.includes('Пустая папка'))).toBe(false);
  });
});

describe('parseBookmarks: экспорт Firefox', () => {
  const { links, skipped } = parseBookmarks(firefoxExport);

  it('корень «Меню закладок» без папки, служебные папки - как есть в пути', () => {
    expect(links).toEqual([
      { url: 'https://support.mozilla.org/ru/products/firefox', name: 'Справка и поддержка Firefox', path: 'Mozilla Firefox' },
      { url: 'https://www.mozilla.org/ru/contribute/', name: 'Присоединяйтесь', path: 'Mozilla Firefox' },
      { url: 'https://www.opennet.ru/', name: 'OpenNET', path: 'Панель закладок' },
      { url: 'https://example.com/recipes/pie', name: 'Пирог яблочный', path: 'Панель закладок/Рецепты выпечка' },
      { url: 'http://192.168.0.1:8080/admin', name: 'Роутер', path: 'Другие закладки' },
      { url: 'https://example.org/a', path: 'Другие закладки' },
    ]);
  });

  it('place: пропускается, разделители HR и описания DD игнорируются', () => {
    expect(skipped).toBe(1);
  });

  it('символы, запрещённые в именах (: и /), из папок и названий убираются', () => {
    const names = links.flatMap((l) => [l.name ?? '', l.path ?? '']);
    expect(names.some((n) => n.includes(':'))).toBe(false);
    expect(links.some((l) => (l.path ?? '').split('/').includes(''))).toBe(false);
  });
});

describe('parseBookmarks: прочее', () => {
  it('закладки без папок - ссылки без пути', () => {
    const html = '<DL><p><DT><A HREF="https://a.com/">A</A><DT><A HREF="https://b.com/">B</A></DL><p>';
    expect(parseBookmarks(html)).toEqual({
      links: [
        { url: 'https://a.com/', name: 'A' },
        { url: 'https://b.com/', name: 'B' },
      ],
      skipped: 0,
    });
  });

  it('это не файл закладок - пусто', () => {
    expect(parseBookmarks('')).toEqual({ links: [], skipped: 0 });
    expect(parseBookmarks('<html><body><p>Привет</p></body></html>')).toEqual({ links: [], skipped: 0 });
  });

  it('очень длинное название обрезается по байтам, не ломая символ', () => {
    const title = 'Я'.repeat(300);
    const [link] = parseBookmarks(`<DL><DT><A HREF="https://a.com/">${title}</A></DL>`).links;
    expect(new TextEncoder().encode(link?.name ?? '').length).toBeLessThanOrEqual(240);
    expect(link?.name).toMatch(/^Я+$/);
  });

  it('папка ".." и пустое имя папки в путь не попадают', () => {
    const html =
      '<DL><DT><H3>..</H3><DL><DT><H3>   </H3><DL><DT><A HREF="https://a.com/">A</A></DL></DL></DL>';
    expect(parseBookmarks(html).links).toEqual([{ url: 'https://a.com/', name: 'A' }]);
  });
});

describe('chunk', () => {
  it('режет на пачки, последняя - остаток', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('пустой список - нет пачек', () => {
    expect(chunk([], 1000)).toEqual([]);
  });

  it('ровно по размеру - одна пачка', () => {
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });
});
