import type { Entry } from '../api/types';
import { foldForSearch } from './fold';

/**
 * Таблица в сейфе - обычный файл `имя.sbtable` (JSON, UTF-8): шифруется, копируется и
 * скачивается как любой другой, сервер о таблицах не знает. Здесь - формат файла и
 * чистые операции над таблицей; экран - TableView, чтение и запись - api/tables.
 */

export const TABLE_EXT = '.sbtable';
const FORMAT = 'safebox-table';
const VERSION = 1;

/** text - как есть; secret - скрыт точками, пока не попросят показать; url - открывается. */
export type ColumnType = 'text' | 'secret' | 'url';

export interface TableColumn {
  id: string;
  name: string;
  type: ColumnType;
}

export interface TableRow {
  id: string;
  /** id столбца -> значение; пустых значений в объекте нет */
  cells: Readonly<Record<string, string>>;
}

export interface TableDoc {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
}

export const COLUMN_TYPES: readonly { type: ColumnType; label: string; hint: string }[] = [
  { type: 'text', label: 'Текст', hint: 'Обычный текст, можно в несколько строк' },
  { type: 'secret', label: 'Секрет', hint: 'Пароль, ПИН, код: скрыт точками, пока не показать' },
  { type: 'url', label: 'Ссылка', hint: 'Адрес сайта: открывается кнопкой' },
];

export function isTable(entry: Pick<Entry, 'kind' | 'name'>): boolean {
  return entry.kind === 'file' && entry.name.toLowerCase().endsWith(TABLE_EXT);
}

/** Имя таблицы на экране: расширение - техническая деталь хранения. */
export function tableTitle(name: string): string {
  return name.toLowerCase().endsWith(TABLE_EXT) ? name.slice(0, -TABLE_EXT.length) : name;
}

// ── Файл ────────────────────────────────────────────────────────────────────

export class TableFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableFormatError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asColumnType = (v: unknown): ColumnType => (v === 'secret' || v === 'url' ? v : 'text');

/** Следующий свободный id вида «c7»: файл остаётся читаемым, id не повторяются после удалений. */
function nextId(prefix: string, taken: Iterable<string>): string {
  let max = 0;
  for (const id of taken) {
    const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/**
 * Текст файла -> таблица. Чужое и испорченное не открываем (TableFormatError с понятным
 * текстом): молча показать пустую таблицу значило бы затереть файл при первой же правке.
 */
export function parseTable(text: string): TableDoc {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new TableFormatError('Файл повреждён: это не таблица SafeBox');
  }
  if (!isRecord(root) || root.format !== FORMAT || !Array.isArray(root.columns) || !Array.isArray(root.rows)) {
    throw new TableFormatError('Файл не похож на таблицу SafeBox');
  }
  if (typeof root.version !== 'number' || root.version > VERSION) {
    throw new TableFormatError('Таблица создана более новой версией SafeBox — обновите программу');
  }

  const columns: TableColumn[] = [];
  const columnIds = new Set<string>();
  for (const c of root.columns) {
    if (!isRecord(c) || typeof c.id !== 'string' || c.id === '' || columnIds.has(c.id)) {
      throw new TableFormatError('Файл повреждён: столбцы таблицы не читаются');
    }
    columnIds.add(c.id);
    columns.push({ id: c.id, name: typeof c.name === 'string' ? c.name : '', type: asColumnType(c.type) });
  }

  const rows: TableRow[] = [];
  const rowIds = new Set<string>();
  for (const r of root.rows) {
    if (!isRecord(r) || !isRecord(r.cells)) {
      throw new TableFormatError('Файл повреждён: строки таблицы не читаются');
    }
    const cells: Record<string, string> = {};
    for (const [key, value] of Object.entries(r.cells)) {
      if (columnIds.has(key) && typeof value === 'string' && value !== '') cells[key] = value;
    }
    // id строки нужен только экрану: битый или повторный заменяем, данные не теряем
    const id = typeof r.id === 'string' && r.id !== '' && !rowIds.has(r.id) ? r.id : nextId('r', rowIds);
    rowIds.add(id);
    rows.push({ id, cells });
  }
  return { columns, rows };
}

/** Таблица -> текст файла. Отступы: скачанный файл читается глазами и сравнивается diff-ом. */
export function serializeTable(doc: TableDoc): string {
  return `${JSON.stringify({ format: FORMAT, version: VERSION, columns: doc.columns, rows: doc.rows }, null, 1)}\n`;
}

// ── Шаблоны ─────────────────────────────────────────────────────────────────

function makeDoc(columns: readonly (readonly [string, ColumnType])[]): TableDoc {
  return { columns: columns.map(([name, type], i) => ({ id: `c${i + 1}`, name, type })), rows: [] };
}

export interface TableTemplate {
  id: string;
  label: string;
  /** имя таблицы по умолчанию */
  title: string;
  hint: string;
  make: () => TableDoc;
}

export const TEMPLATES: readonly TableTemplate[] = [
  {
    id: 'passwords',
    label: 'Пароли',
    title: 'Пароли',
    hint: 'Сервис, логин, пароль, сайт, заметка',
    make: () =>
      makeDoc([
        ['Сервис', 'text'],
        ['Логин', 'text'],
        ['Пароль', 'secret'],
        ['Сайт', 'url'],
        ['Заметка', 'text'],
      ]),
  },
  {
    id: 'cards',
    label: 'Банковские карты',
    title: 'Карты',
    hint: 'Банк, номер, срок, CVV, ПИН, заметка',
    make: () =>
      makeDoc([
        ['Банк', 'text'],
        ['Номер карты', 'secret'],
        ['Срок', 'text'],
        ['CVV', 'secret'],
        ['ПИН', 'secret'],
        ['Заметка', 'text'],
      ]),
  },
  {
    id: 'empty',
    label: 'Пустая',
    title: 'Таблица',
    hint: 'Два столбца, остальное добавите сами',
    make: () =>
      makeDoc([
        ['Название', 'text'],
        ['Значение', 'text'],
      ]),
  },
];

// ── Правки (все - без изменения исходной таблицы) ───────────────────────────

export function cellOf(row: TableRow | undefined, columnId: string): string {
  return row?.cells[columnId] ?? '';
}

export function isRowEmpty(row: TableRow): boolean {
  return Object.keys(row.cells).length === 0;
}

function withCell(cells: Readonly<Record<string, string>>, columnId: string, value: string): Record<string, string> {
  const next = { ...cells };
  if (value === '') delete next[columnId];
  else next[columnId] = value;
  return next;
}

/** Значение ячейки; то же значение - та же таблица (правки нет, сохранять нечего). */
export function setCell(doc: TableDoc, rowId: string, columnId: string, value: string): TableDoc {
  const row = doc.rows.find((r) => r.id === rowId);
  if (row === undefined || cellOf(row, columnId) === value) return doc;
  return {
    ...doc,
    rows: doc.rows.map((r) => (r === row ? { ...r, cells: withCell(r.cells, columnId, value) } : r)),
  };
}

/** Новая строка в конце; rowId - её id (экран ставит на неё курсор). */
export function addRow(doc: TableDoc, cells: Readonly<Record<string, string>> = {}): { doc: TableDoc; rowId: string } {
  const rowId = nextId('r', doc.rows.map((r) => r.id));
  const clean: Record<string, string> = {};
  for (const c of doc.columns) {
    const v = cells[c.id];
    if (v !== undefined && v !== '') clean[c.id] = v;
  }
  return { doc: { ...doc, rows: [...doc.rows, { id: rowId, cells: clean }] }, rowId };
}

export function deleteRows(doc: TableDoc, rowIds: ReadonlySet<string>): TableDoc {
  const rows = doc.rows.filter((r) => !rowIds.has(r.id));
  return rows.length === doc.rows.length ? doc : { ...doc, rows };
}

/** Новый столбец справа от afterId (не задан - в конце). */
export function addColumn(
  doc: TableDoc,
  name: string,
  type: ColumnType = 'text',
  afterId?: string,
): { doc: TableDoc; columnId: string } {
  const columnId = nextId('c', doc.columns.map((c) => c.id));
  const at = afterId === undefined ? -1 : doc.columns.findIndex((c) => c.id === afterId);
  const columns = [...doc.columns];
  columns.splice(at < 0 ? columns.length : at + 1, 0, { id: columnId, name, type });
  return { doc: { ...doc, columns }, columnId };
}

/** Имя нового столбца: «Столбец N», не занятое в таблице. */
export function freeColumnName(doc: TableDoc): string {
  const taken = new Set(doc.columns.map((c) => foldForSearch(c.name)));
  for (let n = doc.columns.length + 1; ; n += 1) {
    const name = `Столбец ${n}`;
    if (!taken.has(foldForSearch(name))) return name;
  }
}

export function updateColumn(doc: TableDoc, columnId: string, patch: Partial<Omit<TableColumn, 'id'>>): TableDoc {
  const column = doc.columns.find((c) => c.id === columnId);
  if (column === undefined) return doc;
  const next = { ...column, ...patch };
  if (next.name === column.name && next.type === column.type) return doc;
  return { ...doc, columns: doc.columns.map((c) => (c === column ? next : c)) };
}

/** Сдвиг столбца на соседнее место: -1 влево, +1 вправо. */
export function moveColumn(doc: TableDoc, columnId: string, delta: -1 | 1): TableDoc {
  const from = doc.columns.findIndex((c) => c.id === columnId);
  const to = from + delta;
  const moved = doc.columns[from];
  if (moved === undefined || to < 0 || to >= doc.columns.length) return doc;
  const columns = doc.columns.filter((c) => c !== moved);
  columns.splice(to, 0, moved);
  return { ...doc, columns };
}

/** Столбец уходит вместе со своими значениями (вернуть - отменой правки). */
export function deleteColumn(doc: TableDoc, columnId: string): TableDoc {
  if (!doc.columns.some((c) => c.id === columnId)) return doc;
  return {
    columns: doc.columns.filter((c) => c.id !== columnId),
    rows: doc.rows.map((r) => (columnId in r.cells ? { ...r, cells: withCell(r.cells, columnId, '') } : r)),
  };
}

/**
 * Вставка блока (из Excel, из текста с табуляцией): значения ложатся от ячейки
 * (startRow, startColumn) вправо и вниз по строкам в том порядке, как они на экране
 * (rowOrder - id видимых строк). Строк не хватило - добавляются новые в конец;
 * столбцы правее последнего отбрасываются (clipped - сколько значений не поместилось).
 */
export function pasteBlock(
  doc: TableDoc,
  rowOrder: readonly string[],
  startRow: number,
  startColumn: number,
  block: readonly (readonly string[])[],
): { doc: TableDoc; clipped: number } {
  const patches = new Map<string, Record<string, string>>();
  const appended: Record<string, string>[] = [];
  let clipped = 0;
  block.forEach((line, dy) => {
    const rowId = rowOrder[startRow + dy];
    let target: Record<string, string>;
    if (rowId === undefined) {
      target = {};
      appended.push(target);
    } else {
      target = patches.get(rowId) ?? {};
      patches.set(rowId, target);
    }
    line.forEach((value, dx) => {
      const column = doc.columns[startColumn + dx];
      if (column === undefined) {
        if (value !== '') clipped += 1;
      } else target[column.id] = value;
    });
  });

  const rows = doc.rows.map((r) => {
    const patch = patches.get(r.id);
    if (patch === undefined) return r;
    let cells = r.cells;
    for (const [columnId, value] of Object.entries(patch)) cells = withCell(cells, columnId, value);
    return { ...r, cells };
  });
  let next: TableDoc = { ...doc, rows };
  for (const cells of appended) {
    if (Object.values(cells).every((v) => v === '')) continue; // пустая строка в конце блока
    next = addRow(next, cells).doc;
  }
  return { doc: next, clipped };
}

// ── Вид: поиск и сортировка (в файл не попадают) ────────────────────────────

export interface TableSort {
  columnId: string;
  dir: 'asc' | 'desc';
}

/** Клик по заголовку: по возрастанию -> по убыванию -> как в файле. */
export function nextSort(current: TableSort | null, columnId: string): TableSort | null {
  if (current === null || current.columnId !== columnId) return { columnId, dir: 'asc' };
  return current.dir === 'asc' ? { columnId, dir: 'desc' } : null;
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/**
 * Строки для экрана. Поиск - по всем словам запроса без учёта регистра, в любых столбцах,
 * кроме секретных: иначе подбором запроса можно было бы узнать скрытый пароль с экрана.
 * Пустые значения при сортировке всегда внизу.
 */
export function viewRows(doc: TableDoc, query: string, sort: TableSort | null): TableRow[] {
  const words = foldForSearch(query).split(/\s+/).filter((w) => w !== '');
  const open = doc.columns.filter((c) => c.type !== 'secret');
  let rows =
    words.length === 0
      ? [...doc.rows]
      : doc.rows.filter((r) => {
          const text = foldForSearch(open.map((c) => cellOf(r, c.id)).join('\n'));
          return words.every((w) => text.includes(w));
        });
  if (sort !== null && doc.columns.some((c) => c.id === sort.columnId)) {
    const sign = sort.dir === 'asc' ? 1 : -1;
    // стабильно: равные остаются в порядке файла
    rows = rows
      .map((row, i) => ({ row, i, key: cellOf(row, sort.columnId) }))
      .sort((a, b) => {
        if ((a.key === '') !== (b.key === '')) return a.key === '' ? 1 : -1;
        return sign * collator.compare(a.key, b.key) || a.i - b.i;
      })
      .map((x) => x.row);
  }
  return rows;
}

// ── CSV и буфер обмена ──────────────────────────────────────────────────────

/**
 * Текст с разделителями -> строки значений. Разделитель - табуляция (буфер Excel),
 * иначе «;» или «,» - что чаще в первой строке. Кавычки по RFC 4180: поле в кавычках
 * может содержать разделитель и перенос строки, «""» - сама кавычка. forced - разделитель
 * известен заранее (буфер обмена - всегда табуляция, запятые в нём - просто текст).
 */
export function parseDelimited(text: string, forced?: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const head = src.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const count = (ch: string) => head.split(ch).length - 1;
  const delimiter = forced ?? (count('\t') > 0 ? '\t' : count(';') > count(',') ? ';' : ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  while (i < src.length) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        quoted = false;
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      endRow();
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV через запятую с заголовком; BOM - чтобы Excel прочитал UTF-8. */
export function toCsv(doc: TableDoc): string {
  const lines = [doc.columns.map((c) => c.name), ...doc.rows.map((r) => doc.columns.map((c) => cellOf(r, c.id)))];
  return `\uFEFF${lines.map((l) => l.map(quoteCsv).join(',')).join('\r\n')}\r\n`;
}

/**
 * Байты CSV -> текст: UTF-8 (с BOM или без), а если это не UTF-8 - windows-1251
 * (так сохраняет CSV русский Excel).
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

/** Тип столбца по имени при импорте: пароли и коды не должны появиться на экране открытыми. */
export function guessColumnType(name: string): ColumnType {
  const n = name.toLowerCase();
  if (/парол|password|passwd|pass\b|pin\b|пин|cvv|cvc|секрет|secret|token|токен|ключ|\bkey\b|код/.test(n)) return 'secret';
  if (/\burl\b|сайт|ссылк|website|\blink\b|адрес сайта/.test(n)) return 'url';
  return 'text';
}

/**
 * Импорт CSV: первая строка - заголовок. В таблицу без данных столбцы приходят из файла
 * (шаблонные заменяются); в таблицу с данными строки дописываются: столбец находится по
 * имени без учёта регистра, незнакомые добавляются справа. added - сколько строк пришло.
 */
export function importMatrix(doc: TableDoc, matrix: readonly (readonly string[])[]): { doc: TableDoc; added: number } {
  const [header, ...body] = matrix;
  if (header === undefined) return { doc, added: 0 };
  const names = header.map((h, i) => (h.trim() === '' ? `Столбец ${i + 1}` : h.trim()));

  let next: TableDoc = doc.rows.every(isRowEmpty) ? { columns: [], rows: [] } : doc;
  const columnIds = names.map((name) => {
    const found = next.columns.find((c) => foldForSearch(c.name) === foldForSearch(name));
    if (found !== undefined) return found.id;
    const created = addColumn(next, name, guessColumnType(name));
    next = created.doc;
    return created.columnId;
  });

  let added = 0;
  for (const line of body) {
    const cells: Record<string, string> = {};
    line.forEach((value, i) => {
      const id = columnIds[i];
      if (id !== undefined && value !== '') cells[id] = value;
    });
    if (Object.keys(cells).length === 0) continue;
    next = addRow(next, cells).doc;
    added += 1;
  }
  return { doc: next, added };
}

// ── Генератор паролей ───────────────────────────────────────────────────────

const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // без l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // без I и O
const DIGITS = '23456789'; // без 0 и 1: не путаются с O и l при вводе с экрана
const SYMBOLS = '!@#$%^&*-_=+?';
const CLASSES = [LOWER, UPPER, DIGITS, SYMBOLS] as const;

/** Случайное число 0..n-1 без перекоса (отбрасываем хвост диапазона). */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] as number;
    if (v < limit) return v % n;
  }
}

/** Пароль из букв, цифр и знаков: каждый вид символов встречается хотя бы раз. */
export function generatePassword(length = 20): string {
  const size = Math.max(length, CLASSES.length);
  const all = CLASSES.join('');
  const chars = CLASSES.map((set) => set[randomBelow(set.length)] as string);
  while (chars.length < size) chars.push(all[randomBelow(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
