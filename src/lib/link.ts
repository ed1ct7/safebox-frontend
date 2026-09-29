import type { PendingFile } from '../api/endpoints';
import type { Entry } from '../api/types';

export function isHttpUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.hostname.length > 0;
  } catch {
    return false;
  }
}

// символы, запрещённые в именах записей (rules.ts), и управляющие
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]+/g;
const MAX_HINT = 60;

/**
 * Имя ссылки: домен без www и «подсказка» из последнего сегмента пути —
 * «github.com — safebox-backend». Просто домен у двух ссылок одного сайта
 * давал бы одинаковые имена.
 */
export function linkNameFromUrl(text: string): string {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return 'Ссылка';
  }
  const host = u.hostname.replace(/^www\./i, '').slice(0, 100);
  const segment = u.pathname.split('/').filter((s) => s !== '').pop() ?? '';
  let hint = segment;
  try {
    hint = decodeURIComponent(segment);
  } catch {
    // битый %-код — оставляем как есть
  }
  hint = hint
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(UNSAFE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_HINT)
    .trim();
  return hint === '' ? host : `${host} — ${hint}`;
}

/** Дубликат ссылки — та же страница: точное совпадение URL среди ссылок папки. */
export function isDuplicateLink(existing: Entry[], url: string): boolean {
  const target = url.trim();
  return existing.some((e) => e.kind === 'link' && e.url === target);
}

/**
 * Свободное имя ярлыка в папке: сервер считает дубликатом файл с тем же именем
 * (без учёта регистра) и тем же размером, а ярлыки разных страниц одного сайта
 * легко совпадают по обоим. Поэтому занятое имя получает суффикс « (2)», « (3)»…
 */
export function uniqueLinkFileName(existing: Entry[], baseName: string): string {
  const taken = new Set(existing.map((e) => e.name.toLocaleLowerCase()));
  let name = `${baseName}.url`;
  for (let n = 2; taken.has(name.toLocaleLowerCase()); n += 1) name = `${baseName} (${n}).url`;
  return name;
}

/**
 * Ссылки попадают в сейф контрактом через импорт ярлыка Windows .url
 * (POST /api/v1/import распознаёт [InternetShortcut] с http(s)-адресом как link).
 */
export function makeUrlShortcut(url: string, fileName: string): PendingFile {
  const text = `[InternetShortcut]\r\nURL=${url.trim()}\r\n`;
  return new File([text], fileName, { type: 'application/octet-stream' }) as PendingFile;
}

/** Имя ссылки на карточке: «.url» — техническая деталь хранения. */
export function displayName(entry: Entry): string {
  return entry.kind === 'link' ? entry.name.replace(/\.url$/i, '') : entry.name;
}
