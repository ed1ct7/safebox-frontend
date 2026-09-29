import type { PendingFile } from '../api/endpoints';
import type { ConflictPolicy, ImportManifest, ImportPlanFile } from '../api/types';

// Чистая логика повторного импорта (UF-15): план, решения, manifest.
// Ключ везде — путь, как в filename части multipart: по нему сервер сверяет файл.

export type Resolutions = ReadonlyMap<string, ConflictPolicy>;

export function pathOf(file: PendingFile): string {
  return file.relativePath ?? file.name;
}

/** Тело POST /import/plan: пути и размеры партии, без содержимого. */
export function planFiles(files: readonly PendingFile[]): ImportPlanFile[] {
  return files.map((f) => ({ path: pathOf(f), size: f.size }));
}

/**
 * Пропущенные файлы на сервер не передаются вовсе; skipped — сколько их было
 * (для тоста). Решение действует на все файлы с этим путём.
 */
export function applyResolutions(
  files: readonly PendingFile[],
  resolutions: Resolutions,
): { send: PendingFile[]; skipped: number } {
  const send: PendingFile[] = [];
  for (const f of files) {
    if (resolutions.get(pathOf(f)) !== 'skip') send.push(f);
  }
  return { send, skipped: files.length - send.length };
}

/** Первая часть multipart: lastModified каждого файла и onConflict у решённых. */
export function buildManifest(
  files: readonly PendingFile[],
  resolutions: Resolutions,
): ImportManifest {
  // fromEntries создаёт собственные свойства: путь «__proto__» не станет прототипом
  return {
    files: Object.fromEntries(
      files.map((f) => {
        const path = pathOf(f);
        const onConflict = resolutions.get(path);
        return [
          path,
          {
            ...(Number.isFinite(f.lastModified) ? { lastModified: f.lastModified } : {}),
            ...(onConflict === undefined ? {} : { onConflict }),
          },
        ];
      }),
    ),
  };
}
