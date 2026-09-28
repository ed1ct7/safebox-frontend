// Рукописные типы, синхронизированные с docs/api.md (репозиторий бэкенда, §4).
// Источник правды по контракту — этот документ; менять только вместе с ним.

export type EntryKind = 'folder' | 'file' | 'photo' | 'video' | 'link';

export interface Entry {
  id: number;
  parentId: number | null; // null — корень «Все объекты»
  kind: EntryKind;
  name: string;
  size: number; // байт; у папки 0
  mime: string; // у папки ''
  hasThumbnail: boolean; // есть /media/:id/thumbnail
  createdAt: number; // unix-мс
  modifiedAt: number; // unix-мс
  url?: string; // только kind === 'link' (http/https)
  domain?: string; // только kind === 'link', для карточки
}

export interface PathItem {
  id: number;
  name: string;
}

export interface Listing {
  folder: Entry | null; // null — корень
  path: PathItem[]; // крошки от корня до папки включительно
  entries: Entry[]; // папки первыми, дальше по имени без учёта регистра
}

export interface FolderNode {
  id: number;
  parentId: number | null;
  name: string;
}

export interface SafeInfo {
  path: string; // полный путь файла сейфа
  entryCount: number; // объектов всего (включая папки)
  idleRemainingSec: number; // до автоблокировки
}

export interface SafeStatus {
  unlocked: boolean; // открыт ли какой-то сейф в сервере
  authorized: boolean; // жив ли переданный Bearer
  lastPath: string | null; // последний открытый/созданный сейф
  defaultDirectory: string; // куда разрешаются относительные пути
  safe?: SafeInfo; // только если authorized
}

export interface Session {
  token: string;
  safe: SafeInfo;
}

export interface SearchHit {
  entry: Entry;
  path: PathItem[]; // папки до родителя
}

export interface ImportResult {
  imported: number;
  failed: number;
  failures: { path: string; message: string }[];
}

export interface ApiError {
  error: { code: string; message: string };
}

// Ответы, не расписанные в §4 api.md
export interface HeartbeatResponse {
  idleRemainingSec: number;
}

export interface RemovedResponse {
  removed: number;
}

export interface FoldersResponse {
  folders: FolderNode[];
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
}
