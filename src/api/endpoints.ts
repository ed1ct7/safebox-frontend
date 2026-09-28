import { api, getToken, setToken, UNAUTHORIZED_EVENT } from './client';
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

export function listEntries(parentId: number | null): Promise<Listing> {
  const q = parentId === null ? '' : `?parentId=${parentId}`;
  return api.get<Listing>(`/api/v1/entries${q}`);
}

export function getFolders(): Promise<FoldersResponse> {
  return api.get<FoldersResponse>('/api/v1/folders');
}

export function renameEntry(id: number, name: string): Promise<Entry> {
  return api.patch<Entry>(`/api/v1/entries/${id}`, { name });
}

export function deleteEntry(id: number): Promise<RemovedResponse> {
  return api.delete<RemovedResponse>(`/api/v1/entries/${id}`);
}

export function deleteEntries(ids: number[]): Promise<RemovedResponse> {
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

/**
 * Импорт multipart-потоком. fetch не даёт прогресса отправки — поэтому XHR.
 * Прогесс считается по байтам; количество файлов известно вызывающему.
 */
export function importEntries(
  parentId: number | null,
  files: PendingFile[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    const fd = new FormData();
    for (const file of files) {
      // имя части = относительный путь: «Папка/Подпапка/фото.jpg»
      fd.append('file', file, file.relativePath ?? file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', parentId === null ? '/api/v1/import' : `/api/v1/import?parentId=${parentId}`);
    const token = getToken();
    if (token !== null) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(xhr.response as ImportResult);
        return;
      }
      if (xhr.status === 401) {
        setToken(null);
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      }
      const body = xhr.response as { error?: { code?: string; message?: string } } | null;
      const message = body?.error?.message ?? `Ошибка ${xhr.status}`;
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Нет соединения с сервером'));
    xhr.send(fd);
  });
}

// ── Медиа (Bearer не нужен: HttpOnly-cookie sbx_media сессии) ───────────────

export function mediaUrl(id: number, what: 'thumbnail' | 'content' | 'download' | 'zip'): string {
  return `/api/v1/media/${id}/${what}`;
}
