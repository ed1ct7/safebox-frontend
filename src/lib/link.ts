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

/**
 * Адреса из текста (буфер обмена, перетаскивание): по строке на адрес, пробелы и
 * пустые строки не в счёт. Корректные http/https - в urls без повторов, остальные -
 * счётчиком invalid (о них скажет тост).
 */
export function parseUrlList(text: string): { urls: string[]; invalid: number } {
  const urls: string[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const value = line.trim();
    if (value === '') continue;
    if (!isHttpUrl(value)) invalid += 1;
    else if (!seen.has(value)) {
      seen.add(value);
      urls.push(value);
    }
  }
  return { urls, invalid };
}

/** Имя ссылки на карточке: «.url» — техническая деталь хранения. */
export function displayName(entry: Entry): string {
  return entry.kind === 'link' ? entry.name.replace(/\.url$/i, '') : entry.name;
}
