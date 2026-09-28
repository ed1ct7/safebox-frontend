import type { QueryClient } from '@tanstack/react-query';
import { listEntries } from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import type { Entry, Listing } from '../api/types';

/**
 * Защита от дублей на клиенте (сервер по контракту v2 не проверяет записи):
 * дубликат = то же имя и тот же размер, что у записи в целевой папке.
 * Имя+размер достаточно: совпадение до байта случайно практически исключено,
 * а хешировать гигабайтные видео ради проверки — дорого.
 */

export interface DedupResult {
  files: PendingFile[];
  skipped: number;
}

export function filterDuplicates(files: PendingFile[], existing: Entry[]): DedupResult {
  const existingKeys = new Set(existing.map((e) => `${e.name}\u0000${e.size}`));
  const seenInBatch = new Set<string>();
  const out: PendingFile[] = [];
  let skipped = 0;

  for (const f of files) {
    const rel = f.relativePath ?? f.name;
    const batchKey = `${rel}\u0000${f.size}`;
    if (seenInBatch.has(batchKey)) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(batchKey);
    // вложенные пути («Папка/файл») попадают в подпапки — с корнем не сравниваем
    if (!rel.includes('/') && existingKeys.has(`${f.name}\u0000${f.size}`)) {
      skipped += 1;
      continue;
    }
    out.push(f);
  }

  return { files: out, skipped };
}

/** Записи целевой папки: из кэша (обычно свежие — пользователь только что там был), иначе запрос. */
export async function existingEntries(
  qc: QueryClient,
  folderId: number | null,
): Promise<Entry[]> {
  const cached = qc.getQueryData<Listing>(['listing', folderId]);
  if (cached !== undefined) return cached.entries;
  try {
    return (await listEntries(folderId)).entries;
  } catch {
    return []; // проверка не должна мешать импорту
  }
}

/**
 * Дубликат ссылки — та же страница: точное совпадение URL (домен не годится:
 * две разные страницы одного сайта — это разные ссылки).
 */
export function isDuplicateLink(existing: Entry[], url: string): boolean {
  const target = url.trim();
  return existing.some((e) => e.kind === 'link' && e.url === target);
}
