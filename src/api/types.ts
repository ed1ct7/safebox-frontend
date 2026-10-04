// Рукописные типы, синхронизированные с «REST API — контракт /api/v1» в Linqtab (раздел «Типы»).
// Источник правды по контракту — этот документ и src/http/src/json.cpp; менять только вместе с ними.

export type EntryKind = 'folder' | 'file' | 'photo' | 'video' | 'link';

/** Присвоение тега записи; inherit — действует на всё поддерево. */
export interface TagRef {
  tagId: number;
  inherit: boolean;
}

/** Тег, унаследованный от предка fromId (снимается только там). */
export interface InheritedTagRef {
  tagId: number;
  fromId: number;
}

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
  description: string; // '' если нет
  childCount: number; // прямых детей (бейдж вложений)
  tags: TagRef[]; // прямые
  inheritedTags: InheritedTagRef[]; // от предков с inherit
  sourceModifiedAt: number | null; // unix-мс изменения исходного файла на диске
  previewPending?: boolean; // только у link: предпросмотр в очереди
}

export interface PathItem {
  id: number;
  name: string;
}

export interface Listing {
  parent: Entry | null; // открытая папка или запись с вложениями; null — корень
  path: PathItem[]; // крошки от корня до parent включительно
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
  path: PathItem[]; // предки до родителя
  matchedIn: 'name' | 'description' | null;
}

/** Как поступить с записью, чьё имя уже занято у нового родителя (UF-14, UF-15). */
export type ConflictPolicy = 'keepBoth' | 'replace' | 'skip';

export interface ImportResult {
  imported: number;
  replaced: number;
  /** пропущенные сервером; отказ от файла в диалоге до загрузки сюда не попадает */
  skipped: number;
  failed: number;
  failures: { path: string; message: string }[];
}

export interface Tag {
  id: number;
  categoryId: number;
  name: string; // основное имя («русское»: на деле любой текст)
  nameEn: string; // второе имя, английское; '' — не задано
}

export interface TagWithCount extends Tag {
  count: number; // записей с прямым присвоением
}

export interface Category {
  id: number;
  name: string;
  nameEn: string; // '' — не задано
  tags: TagWithCount[];
}

/** На каком языке показывать имена тегов и категорий; сам интерфейс всегда русский. */
export type TagLanguage = 'ru' | 'en';

export interface Settings {
  linkPreviews: boolean;
  tagLanguage: TagLanguage;
}

export interface ApiError {
  error: { code: string; message: string };
}

// Ответы эндпоинтов (разделы «Сейф», «Записи», «Поиск» контракта)
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

export interface TagsResponse {
  categories: Category[];
}

export interface RemovedTagsResponse {
  removedTags: number;
  affectedEntries: number;
}

export interface AffectedResponse {
  affectedEntries: number;
}

export interface UpdatedResponse {
  updated: number;
}

/** PATCH /entries/:id: переданные поля меняются, остальные остаются. */
export interface EntryPatch {
  name?: string;
  description?: string;
  url?: string; // только у ссылки, http/https
}

export interface MoveConflict {
  id: number; // перемещаемая запись
  existing: Entry; // занявшая имя у нового родителя
}

export interface MovePlanResponse {
  conflicts: MoveConflict[];
}

export interface MoveResult {
  moved: number;
  replaced: number;
  skipped: number;
}

export interface ImportPlanFile {
  path: string; // как в filename части multipart
  size: number;
}

export interface ImportConflict {
  path: string;
  existing: Entry;
}

export interface ImportPlanResponse {
  conflicts: ImportConflict[];
  newFiles: number;
}

/** Первая часть multipart-импорта: lastModified файла и решение по совпадению имени. */
export interface ImportManifest {
  files: Record<string, { lastModified?: number; onConflict?: ConflictPolicy }>;
}

export type TagMatch = 'categories' | 'all' | 'any';

export interface NewLink {
  url: string;
  name?: string;
  path?: string; // «Закладки/Работа» — папки по правилам импорта
}

export interface CreateLinksResponse {
  created: Entry[];
  existing: { url: string; entryId: number }[];
  invalid: string[];
}
