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
  AffectedResponse,
  Category,
  ConflictPolicy,
  CreateLinksResponse,
  Entry,
  EntryPatch,
  FoldersResponse,
  HeartbeatResponse,
  ImportManifest,
  ImportPlanFile,
  ImportPlanResponse,
  ImportResult,
  Listing,
  MovePlanResponse,
  MoveResult,
  NewLink,
  RemovedResponse,
  RemovedTagsResponse,
  SafeStatus,
  SearchResponse,
  Session,
  Settings,
  Tag,
  TagMatch,
  TagRef,
  TagsResponse,
  UpdatedResponse,
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

/** parentId — любая запись: у папки это содержимое, у остальных — вложения (UF-14). */
export function listEntries(parentId: number | null): Promise<Listing> {
  return api.get<Listing>(withParent('/api/v1/entries', parentId));
}

/** Одна запись со всеми полями: имя источника унаследованного тега и переход к нему (UF-16). */
export function getEntry(id: number): Promise<Entry> {
  return api.get<Entry>(`/api/v1/entries/${id}`);
}

export function getFolders(): Promise<FoldersResponse> {
  return api.get<FoldersResponse>('/api/v1/folders');
}

/** Имя, описание и адрес ссылки: что передано, то и меняется (UF-22). */
export function updateEntry(id: number, patch: EntryPatch): Promise<Entry> {
  return api.patch<Entry>(`/api/v1/entries/${id}`, patch);
}

/** Какие имена у нового родителя заняты (UF-14): конфликтов нет — можно сразу move. */
export function planMove(ids: number[], parentId: number | null): Promise<MovePlanResponse> {
  return api.post<MovePlanResponse>('/api/v1/entries/move/plan', { ids, parentId });
}

/** resolutions: id перемещаемой записи -> решение; без решения — keepBoth. */
export function moveEntries(
  ids: number[],
  parentId: number | null,
  resolutions?: Readonly<Record<string, ConflictPolicy>>,
): Promise<MoveResult> {
  const hasResolutions = resolutions !== undefined && Object.keys(resolutions).length > 0;
  return api.post<MoveResult>('/api/v1/entries/move', {
    ids,
    parentId,
    ...(hasResolutions ? { resolutions } : {}),
  });
}

/** Теги (UF-16): add добавляет или обновляет inherit, remove снимает — у всех ids разом. */
export function assignTags(
  ids: number[],
  change: { add?: TagRef[]; remove?: number[] },
): Promise<UpdatedResponse> {
  return api.post<UpdatedResponse>('/api/v1/entries/tags', { ids, ...change });
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

export interface SearchOptions {
  tags?: readonly number[];
  match?: TagMatch;
  within?: number; // только потомки этой записи
  limit?: number;
}

/** q и tags одновременно пустые — сервер вернёт пустой список. */
export function searchPath(q: string, opts: SearchOptions = {}): string {
  const params = new URLSearchParams({ q });
  if (opts.tags !== undefined && opts.tags.length > 0) params.set('tags', opts.tags.join(','));
  if (opts.match !== undefined) params.set('match', opts.match);
  if (opts.within !== undefined) params.set('within', String(opts.within));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  return `/api/v1/search?${params.toString()}`;
}

export function searchEntries(q: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  return api.get<SearchResponse>(searchPath(q, opts));
}

// ── Теги ────────────────────────────────────────────────────────────────────

export function getTags(): Promise<TagsResponse> {
  return api.get<TagsResponse>('/api/v1/tags');
}

export function createCategory(name: string): Promise<Category> {
  return api.post<Category>('/api/v1/tags/categories', { name });
}

export function renameCategory(id: number, name: string): Promise<Category> {
  return api.patch<Category>(`/api/v1/tags/categories/${id}`, { name });
}

export function deleteCategory(id: number): Promise<RemovedTagsResponse> {
  return api.delete<RemovedTagsResponse>(`/api/v1/tags/categories/${id}`);
}

/** 201 — тег создан, 200 — такой уже был. Нет категории и createCategory не true — 404. */
export async function createTag(cmd: {
  category: string;
  name: string;
  createCategory?: boolean;
}): Promise<{ tag: Tag; created: boolean }> {
  const r = await api.postWithStatus<Tag>('/api/v1/tags', cmd);
  return { tag: r.data, created: r.status === 201 };
}

export function updateTag(id: number, patch: { name?: string; categoryId?: number }): Promise<Tag> {
  return api.patch<Tag>(`/api/v1/tags/${id}`, patch);
}

export function mergeTag(from: number, into: number): Promise<AffectedResponse> {
  return api.post<AffectedResponse>(`/api/v1/tags/${from}/merge`, { into });
}

export function deleteTag(id: number): Promise<AffectedResponse> {
  return api.delete<AffectedResponse>(`/api/v1/tags/${id}`);
}

// ── Ссылки и настройки ──────────────────────────────────────────────────────

export function createLinks(
  parentId: number | null,
  links: NewLink[],
): Promise<CreateLinksResponse> {
  return api.post<CreateLinksResponse>('/api/v1/links', { parentId, links });
}

/** Синхронно, до 15 с; 502 — причина в message сервера (UF-21). */
export function refreshPreview(id: number): Promise<Entry> {
  return api.post<Entry>(`/api/v1/entries/${id}/preview`);
}

export function getSettings(): Promise<Settings> {
  return api.get<Settings>('/api/v1/settings');
}

export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return api.patch<Settings>('/api/v1/settings', patch);
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

/** Что уже лежит в целевой папке под такими же именами (UF-15) — до отправки байтов. */
export function planImport(
  parentId: number | null,
  files: ImportPlanFile[],
): Promise<ImportPlanResponse> {
  return api.post<ImportPlanResponse>(withParent('/api/v1/import/plan', parentId), { files });
}

/**
 * Тело импорта: manifest — первая часть и без filename (строка, а не Blob: иначе
 * FormData добавит имя файла, и сервер не признает её манифестом), дальше файлы.
 */
export function buildImportForm(files: PendingFile[], manifest?: ImportManifest): FormData {
  const fd = new FormData();
  if (manifest !== undefined) fd.append('manifest', JSON.stringify(manifest));
  for (const file of files) {
    // имя части = относительный путь: «Папка/Подпапка/фото.jpg»
    fd.append('file', file, file.relativePath ?? file.name);
  }
  return fd;
}

/**
 * Импорт multipart-потоком. fetch не даёт прогресса отправки — поэтому XHR.
 * Прогресс считается по байтам; количество файлов известно вызывающему.
 * Совпадения имён вызывающий решает заранее (planImport) и передаёт в manifest;
 * пропущенные файлы сюда не попадают вовсе.
 */
export function importEntries(
  parentId: number | null,
  files: PendingFile[],
  opts: {
    manifest?: ImportManifest;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    const aborted = () => new DOMException('Импорт отменён', 'AbortError');
    if (opts.signal?.aborted === true) {
      reject(aborted());
      return;
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
          resolve({
            ...data,
            replaced: data.replaced ?? 0,
            skipped: data.skipped ?? 0,
            failures: data.failures ?? [],
          });
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
    xhr.send(buildImportForm(files, opts.manifest));
  });
}

// ── Медиа (Bearer не нужен: HttpOnly-cookie sbx_media сессии) ───────────────

export function mediaUrl(id: number, what: 'thumbnail' | 'content' | 'download' | 'zip'): string {
  return `/api/v1/media/${id}/${what}`;
}

/** Файл — оригинал с оригинальным именем, папка — zip (UF-11), ссылка — ярлык `имя.url`. */
export function downloadUrlOf(entry: Entry): string | null {
  return mediaUrl(entry.id, entry.kind === 'folder' ? 'zip' : 'download');
}

/** «Скачать вложения» (UF-11): zip детей записи. У папки «Скачать» и есть такой zip. */
export function attachmentsZipUrlOf(entry: Entry): string | null {
  if (entry.kind === 'folder' || entry.childCount === 0) return null;
  return mediaUrl(entry.id, 'zip');
}
