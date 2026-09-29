import {
  api,
  ApiRequestError,
  getToken,
  handleUnauthorized,
  networkError,
  parseBody,
  toApiError,
} from './client';
import type {
  Entry,
  FoldersResponse,
  HeartbeatResponse,
  ImportResult,
  Listing,
  RemovedResponse,
  SafeStatus,
  SearchResponse,
  Session,
} from './types';

// ── Сейф ────────────────────────────────────────────────────────────────────

export function getSafeStatus(): Promise<SafeStatus> {
  return api.get<SafeStatus>('/api/v1/safe/status');
}

export function createSafe(path: string, password: string, confirm: string): Promise<Session> {
  return api.post<Session>('/api/v1/safe/create', { path, password, confirm });
}

export function unlockSafe(path: string, password: string): Promise<Session> {
  return api.post<Session>('/api/v1/safe/unlock', { path, password });
}

export function lockSafe(): Promise<void> {
  return api.post<void>('/api/v1/safe/lock');
}

export function changePassword(
  oldPassword: string,
  newPassword: string,
  confirm: string,
): Promise<void> {
  return api.post<void>('/api/v1/safe/password', { oldPassword, newPassword, confirm });
}

export function heartbeat(active: boolean): Promise<HeartbeatResponse> {
  return api.post<HeartbeatResponse>('/api/v1/safe/heartbeat', { active });
}

// ── Записи ──────────────────────────────────────────────────────────────────

function withParent(path: string, parentId: number | null): string {
  return parentId === null ? path : `${path}?parentId=${parentId}`;
}

export function listEntries(parentId: number | null): Promise<Listing> {
  return api.get<Listing>(withParent('/api/v1/entries', parentId));
}

export function getFolders(): Promise<FoldersResponse> {
  return api.get<FoldersResponse>('/api/v1/folders');
}

export function renameEntry(id: number, name: string): Promise<Entry> {
  return api.patch<Entry>(`/api/v1/entries/${id}`, { name });
}

/** Одна запись — DELETE /entries/:id, несколько — одной транзакцией. */
export function deleteEntries(ids: number[]): Promise<RemovedResponse> {
  const [only] = ids;
  if (ids.length === 1 && only !== undefined) {
    return api.delete<RemovedResponse>(`/api/v1/entries/${only}`);
  }
  return api.post<RemovedResponse>('/api/v1/entries/delete', { ids });
}

// ── Поиск ───────────────────────────────────────────────────────────────────

export function searchEntries(q: string, limit?: number): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set('limit', String(limit));
  return api.get<SearchResponse>(`/api/v1/search?${params.toString()}`);
}

// ── Импорт ──────────────────────────────────────────────────────────────────

/** Файл с относительным путём: папки при импорте восстанавливаются по нему. */
export type PendingFile = File & { relativePath?: string };

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function isImportResult(v: unknown): v is ImportResult {
  const r = v as Partial<ImportResult> | null | undefined;
  return typeof r?.imported === 'number' && typeof r.failed === 'number';
}

/**
 * Импорт multipart-потоком. fetch не даёт прогресса отправки — поэтому XHR.
 * Прогресс считается по байтам; количество файлов известно вызывающему.
 * Дубликаты (та же папка + имя + размер) отсеивает сервер — см. ImportResult.skipped.
 */
export function importEntries(
  parentId: number | null,
  files: PendingFile[],
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    const aborted = () => new DOMException('Импорт отменён', 'AbortError');
    if (opts.signal?.aborted === true) {
      reject(aborted());
      return;
    }

    const fd = new FormData();
    for (const file of files) {
      // имя части = относительный путь: «Папка/Подпапка/фото.jpg»
      fd.append('file', file, file.relativePath ?? file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', withParent('/api/v1/import', parentId));
    const token = getToken();
    if (token !== null) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      const data = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (isImportResult(data)) {
          resolve({ ...data, skipped: data.skipped ?? 0, failures: data.failures ?? [] });
        } else {
          reject(new ApiRequestError(xhr.status, 'bad_response', 'Некорректный ответ сервера'));
        }
        return;
      }
      if (xhr.status === 401) handleUnauthorized();
      reject(toApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(aborted());
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}

// ── Медиа (Bearer не нужен: HttpOnly-cookie sbx_media сессии) ───────────────

export function mediaUrl(id: number, what: 'thumbnail' | 'content' | 'download' | 'zip'): string {
  return `/api/v1/media/${id}/${what}`;
}

/** Файл — оригинал с оригинальным именем, папка — zip (UF-11). У ссылки скачивать нечего. */
export function downloadUrlOf(entry: Entry): string | null {
  if (entry.kind === 'link') return null;
  return mediaUrl(entry.id, entry.kind === 'folder' ? 'zip' : 'download');
}
