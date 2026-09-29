import type { NewLink } from '../api/types';
import { isHttpUrl } from './link';

// Импорт закладок браузера (UF-20): HTML-экспорт Chrome, Edge, Firefox в формате
// Netscape Bookmark: <DL> - список, <DT><H3> - папка, за ней <DL> с её содержимым,
// <DT><A HREF> - закладка. Чистая логика: тестируется без сети.

/** Закладок в одном запросе POST /links: сервер берёт до 10 000, но запрос не должен висеть долго. */
export const LINK_BATCH = 1000;

// с запасом до 255 байт сервера: занятое имя получит суффикс « (2)»
const MAX_NAME_BYTES = 240;
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]+/g;
const encoder = new TextEncoder();

/** Имя папки или закладки в допустимом для записи виде; пустая строка - имени нет. */
function cleanName(raw: string): string {
  const text = raw.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (text === '.' || text === '..') return '';
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (bytes + size > MAX_NAME_BYTES) break;
    out += ch;
    bytes += size;
  }
  return out.trim();
}

export interface ParsedBookmarks {
  links: NewLink[];
  /** закладки без адреса или не http/https: javascript:, place:, chrome:// и т.п. */
  skipped: number;
}

/**
 * Закладки файла с путём папок «Папка/Подпапка». Служебные папки браузера
 * («Панель закладок», «Bookmarks bar», «Other bookmarks») остаются в пути как есть.
 * Название закладки становится именем ссылки; если его нет или оно само адрес -
 * имя не передаётся, сейф подставит домен и название страницы.
 */
export function parseBookmarks(html: string): ParsedBookmarks {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links: NewLink[] = [];
  let skipped = 0;
  // имя папки из последнего H3: её содержимое - ближайший следующий DL
  let folder = '';

  const walk = (node: Element, path: readonly string[]): void => {
    for (const child of Array.from(node.children)) {
      switch (child.tagName) {
        case 'H3':
          folder = cleanName(child.textContent ?? '');
          break;
        case 'DL': {
          const inner = folder === '' ? path : [...path, folder];
          folder = '';
          walk(child, inner);
          break;
        }
        case 'A': {
          const url = (child.getAttribute('href') ?? '').trim();
          if (!isHttpUrl(url)) {
            skipped += 1;
            break;
          }
          const link: NewLink = { url };
          const title = child.textContent ?? '';
          const name = /^https?:\/\//i.test(title.trim()) ? '' : cleanName(title);
          if (name !== '') link.name = name;
          if (path.length > 0) link.path = path.join('/');
          links.push(link);
          break;
        }
        default:
          walk(child, path); // DT, P, DD и прочее, во что парсер завернул содержимое
      }
    }
  };
  walk(doc.body, []);
  return { links, skipped };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
