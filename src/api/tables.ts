import { parseTable, serializeTable, TABLE_EXT } from '../lib/table';
import type { TableDoc } from '../lib/table';
import { ApiRequestError, handleUnauthorized, networkError, parseBody, toApiError } from './client';
import { getEntry, importEntries, mediaUrl, planImport } from './endpoints';
import type { PendingFile } from './endpoints';
import type { Entry } from './types';

// Таблица хранится файлом записи (lib/table): читается через /media/:id/content, пишется
// импортом с onConflict=replace - сервер меняет содержимое, а id, имя, теги, описание и
// вложения записи остаются. Отдельного эндпоинта у таблиц нет.

/** Больше не читаем: таблица целиком живёт в памяти вкладки и переписывается при каждой правке. */
export const MAX_TABLE_BYTES = 8 * 1024 * 1024;

/** Содержимое в сейфе уже не то, с которого начинали правку (другое окно или вкладка). */
export class TableConflictError extends Error {
  constructor() {
    super('Таблицу изменили в другом окне');
    this.name = 'TableConflictError';
  }
}

/** Что лежит в сейфе: по этому снимку сохранение замечает чужую правку. */
export interface TableBase {
  /** текст файла, как он прочитан или записан последним */
  text: string;
  modifiedAt: number;
}

/** Текст файла таблицы; cookie sbx_media, как у остального содержимого. */
export async function fetchTableText(id: number): Promise<string> {
  let res: Response;
  let bytes: ArrayBuffer;
  try {
    res = await fetch(mediaUrl(id, 'content'), { cache: 'no-store' });
    bytes = await res.arrayBuffer();
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    throw toApiError(res.status, parseBody(new TextDecoder().decode(bytes)));
  }
  if (bytes.byteLength > MAX_TABLE_BYTES) {
    throw new ApiRequestError(413, 'too_large', 'Таблица слишком большая, чтобы открыть её здесь — скачайте файл');
  }
  return new TextDecoder().decode(bytes);
}

/** Запись и её таблица. Не таблица внутри файла - TableFormatError (lib/table). */
export async function loadTable(id: number): Promise<{ entry: Entry; doc: TableDoc; base: TableBase }> {
  const entry = await getEntry(id);
  const text = await fetchTableText(id);
  return { entry, doc: parseTable(text), base: { text, modifiedAt: entry.modifiedAt } };
}

function tableFile(name: string, text: string): PendingFile {
  return new File([text], name, { type: 'application/json' });
}

function failed(message: string): ApiRequestError {
  return new ApiRequestError(409, 'conflict', message);
}

/**
 * Новая таблица в папке (или во вложениях записи) parentId. Занятое имя получает приписку
 * «(2)». Возвращает id записи; null - сервер старше Ф3 и не говорит, что записал
 * (таблица создана, но открыть её сразу нечем).
 */
export async function createTable(parentId: number | null, title: string, doc: TableDoc): Promise<number | null> {
  const name = `${title}${TABLE_EXT}`;
  const result = await importEntries(parentId, [tableFile(name, serializeTable(doc))], {
    // onDuplicate: две пустые таблицы по одному шаблону совпадают по содержимому байт в байт
    manifest: { files: { [name]: { onConflict: 'keepBoth', onDuplicate: 'import' } } },
  });
  if (result.imported !== 1) {
    throw failed(result.failures[0]?.message ?? 'Не удалось создать таблицу');
  }
  return result.importedFiles?.[0]?.id ?? null;
}

/**
 * Записать текст таблицы в запись id. Перед записью:
 *  - запись читается заново (имя и папка могли смениться в другом окне);
 *  - если она менялась после base, сверяется содержимое: чужая правка - TableConflictError
 *    (force - писать поверх); правка только имени, описания или тегов конфликтом не считается;
 *  - план импорта подтверждает, что это имя в папке занято именно этой записью: замена
 *    находит запись по имени, а при двух одинаковых именах в папке задела бы чужую.
 * Возвращает новый снимок и свежую запись (размер и дата на карточке).
 */
export async function saveTableText(
  id: number,
  text: string,
  base: TableBase,
  opts: { force?: boolean } = {},
): Promise<{ base: TableBase; entry: Entry }> {
  const current = await getEntry(id);
  if (current.modifiedAt !== base.modifiedAt && opts.force !== true) {
    if ((await fetchTableText(id)) !== base.text) throw new TableConflictError();
  }

  const size = new Blob([text]).size;
  const plan = await planImport(current.parentId, [{ path: current.name, size }]);
  const occupant = plan.conflicts[0]?.existing;
  if (occupant === undefined) {
    throw failed('Таблица удалена или перемещена — изменения не сохранены');
  }
  if (occupant.id !== id) {
    throw failed(`В этой папке есть ещё одна запись с именем «${current.name}» — переименуйте одну из них`);
  }

  const result = await importEntries(current.parentId, [tableFile(current.name, text)], {
    manifest: { files: { [current.name]: { onConflict: 'replace', onDuplicate: 'import' } } },
  });
  if (result.replaced !== 1) {
    throw failed(result.failures[0]?.message ?? 'Не удалось сохранить таблицу');
  }
  const entry = await getEntry(id);
  return { base: { text, modifiedAt: entry.modifiedAt }, entry };
}
