import type { PendingFile } from '../api/endpoints';

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

/** Имя ссылки = домен без www (лишние нажатия не нужны: вставил URL — готово). */
export function linkNameFromUrl(text: string): string {
  try {
    const u = new URL(text.trim());
    const host = u.hostname.replace(/^www\./i, '');
    return host.slice(0, 200);
  } catch {
    return 'Ссылка';
  }
}

/**
 * Ссылки попадают в сейф контрактом через импорт ярлыка Windows .url
 * (POST /api/v1/import распознаёт .url с http(s)-адресом как link).
 * Отдельного окна не нужно: URL вставляется прямо в галерею (Ctrl+V)
 * или в инлайн-поле сверху.
 */
export function makeUrlShortcut(url: string): PendingFile {
  const name = linkNameFromUrl(url);
  const text = `[InternetShortcut]\r\nURL=${url.trim()}\r\n`;
  const blob = new Blob([text], { type: 'application/octet-stream' });
  return new File([blob], `${name}.url`, { type: 'application/octet-stream' }) as PendingFile;
}
