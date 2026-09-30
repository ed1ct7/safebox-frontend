import type { PendingFile } from '../api/endpoints';
import type { ConflictPolicy, Entry, ImportConflict, MoveConflict } from '../api/types';
import { plural } from './format';
import { pathOf } from './importPlan';
import type { Resolutions } from './importPlan';

// Общая логика диалога «имя уже занято» (UF-15 при импорте, UF-14 при перемещении).

export type ConflictKind = 'import' | 'move';

/** Одна сторона совпадения: что приходит или что уже лежит. */
export interface ConflictSide {
  folder: boolean;
  size: number | null; // null — неизвестен
  modifiedAt: number | null; // unix-мс
}

export interface ConflictItem {
  key: string; // путь файла (импорт) или id записи (перемещение)
  name: string;
  incoming: ConflictSide;
  existing: ConflictSide;
}

export interface ConflictRequest {
  kind: ConflictKind;
  items: ConflictItem[];
}

export const CONFLICT_TEXTS: Record<
  ConflictKind,
  { incoming: string; existing: string; noun: readonly [string, string, string] }
> = {
  import: { incoming: 'Из импорта', existing: 'В сейфе', noun: ['файл', 'файла', 'файлов'] },
  move: {
    incoming: 'Из перемещаемого',
    existing: 'В папке',
    noun: ['запись', 'записи', 'записей'],
  },
};

/** «В папке уже есть 3 файла с такими же именами». */
export function conflictTitle(kind: ConflictKind, count: number): string {
  const [one, few, many] = CONFLICT_TEXTS[kind].noun;
  const same = count === 1 ? 'таким же именем' : 'такими же именами';
  return `В папке уже есть ${plural(count, one, few, many)} с ${same}`;
}

// ── Решения ─────────────────────────────────────────────────────────────────

/** Две галочки на файл: «оттуда» и «отсюда». Обе сняты — решения нет. */
export interface Choice {
  incoming: boolean;
  existing: boolean;
}

/** Ответ диалога: решения по файлам, спецвариант «оставить оба, переименовав
 * лежащие в папке» (только перемещение) или null - отмена всей операции. */
export type ConflictAnswer = Resolutions | 'rename-existing' | null;

/** Только приходящий — заменить, только лежащий — пропустить, оба — оставить оба. */
export function policyOfChoice(choice: Choice): ConflictPolicy | null {
  if (choice.incoming && choice.existing) return 'keepBoth';
  if (choice.incoming) return 'replace';
  if (choice.existing) return 'skip';
  return null;
}

/** «Заменить» и «Пропустить» на всё разом. */
export function uniformResolutions(items: readonly ConflictItem[], policy: ConflictPolicy): Resolutions {
  return new Map(items.map((i) => [i.key, policy]));
}

export function unresolvedCount(
  items: readonly ConflictItem[],
  choices: ReadonlyMap<string, Choice>,
): number {
  let n = 0;
  for (const i of items) {
    const c = choices.get(i.key);
    if (c === undefined || policyOfChoice(c) === null) n += 1;
  }
  return n;
}

/** Решения по галочкам; null — у какого-то файла нет ни одной, продолжать нельзя. */
export function resolutionsFromChoices(
  items: readonly ConflictItem[],
  choices: ReadonlyMap<string, Choice>,
): Resolutions | null {
  const out = new Map<string, ConflictPolicy>();
  for (const i of items) {
    const c = choices.get(i.key);
    const policy = c === undefined ? null : policyOfChoice(c);
    if (policy === null) return null;
    out.set(i.key, policy);
  }
  return out;
}

// ── Данные для диалога ──────────────────────────────────────────────────────

/** У записи сейфа — дата изменения исходного файла на момент импорта, если известна. */
export function sideOfEntry(e: Entry): ConflictSide {
  return {
    folder: e.kind === 'folder',
    size: e.kind === 'folder' ? null : e.size,
    modifiedAt: e.sourceModifiedAt ?? e.modifiedAt,
  };
}

/** Совпадения импорта: у приходящего размер и дата берутся из самого файла. */
export function importConflictItems(
  conflicts: readonly ImportConflict[],
  files: readonly PendingFile[],
): ConflictItem[] {
  const byPath = new Map<string, PendingFile>();
  for (const f of files) {
    const path = pathOf(f);
    if (!byPath.has(path)) byPath.set(path, f);
  }
  return conflicts.map((c) => {
    const file = byPath.get(c.path);
    return {
      key: c.path,
      name: c.path,
      incoming: {
        folder: false,
        size: file?.size ?? null,
        modifiedAt: file === undefined || !Number.isFinite(file.lastModified) ? null : file.lastModified,
      },
      existing: sideOfEntry(c.existing),
    };
  });
}

/** Совпадения перемещения: ключ — id перемещаемой записи. */
export function moveConflictItems(
  conflicts: readonly MoveConflict[],
  moving: readonly Entry[],
): ConflictItem[] {
  const byId = new Map(moving.map((e) => [e.id, e]));
  return conflicts.map((c) => {
    const entry = byId.get(c.id);
    return {
      key: String(c.id),
      name: entry?.name ?? c.existing.name,
      incoming:
        entry === undefined ? { folder: false, size: null, modifiedAt: null } : sideOfEntry(entry),
      existing: sideOfEntry(c.existing),
    };
  });
}

/** Ключи перемещения -> тело запроса: {"<id>": решение}. */
export function resolutionsToRecord(resolutions: Resolutions): Record<string, ConflictPolicy> {
  return Object.fromEntries(resolutions);
}
