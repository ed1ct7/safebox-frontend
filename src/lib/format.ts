import type { CreateLinksResponse, Entry, ImportResult, MoveResult } from '../api/types';

const UNITS = ['КБ', 'МБ', 'ГБ', 'ТБ'] as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const text = v >= 100 ? String(Math.round(v)) : v.toFixed(1);
  return `${text} ${UNITS[i] ?? ''}`.trim();
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

type SummaryKind = 'success' | 'error' | 'info';

/**
 * Тост по итогам импорта (UF-7, UF-15): «Импортировано: N, заменено: K, пропущено: M»
 * + ошибки. skippedByUser - файлы, от которых отказались в диалоге: на сервер
 * они не уходили и в его skipped не входят.
 */
export function importSummary(
  r: ImportResult,
  source?: string,
  skippedByUser = 0,
): { text: string; kind: SummaryKind } {
  const from = source === undefined || source === '' ? '' : ` из «${source}»`;
  const skipped = r.skipped + skippedByUser;
  if (r.imported === 0 && r.replaced === 0 && r.failed === 0) {
    return skipped > 0
      ? { text: `Пропущено${from}: ${skipped}`, kind: 'info' }
      : { text: `Нечего импортировать${from}`, kind: 'info' };
  }
  const parts = [`Импортировано${from}: ${r.imported}`];
  if (r.replaced > 0) parts.push(`заменено: ${r.replaced}`);
  if (skipped > 0) parts.push(`пропущено: ${skipped}`);
  if (r.failed > 0) parts.push(`ошибок: ${r.failed}`);
  let text = parts.join(', ');
  const first = r.failures[0];
  if (first !== undefined) text += `\n${first.path}: ${first.message}`;
  return { text, kind: r.failed > 0 ? 'error' : 'success' };
}

/** Тост по итогам перемещения (UF-14). */
export function moveSummary(r: MoveResult): { text: string; kind: SummaryKind } {
  if (r.moved === 0 && r.replaced === 0) {
    return r.skipped > 0
      ? { text: `Пропущено: ${r.skipped}`, kind: 'info' }
      : { text: 'Ничего не перемещено', kind: 'info' };
  }
  const parts = [`Перемещено: ${r.moved}`];
  if (r.replaced > 0) parts.push(`заменено: ${r.replaced}`);
  if (r.skipped > 0) parts.push(`пропущено: ${r.skipped}`);
  return { text: parts.join(', '), kind: 'success' };
}

/** Один тост; showId - запись, к которой ведёт кнопка «Показать». */
export interface ToastSpec {
  text: string;
  kind: SummaryKind;
  showId?: number;
}

/**
 * Тосты по ответу POST /links (UF-20): что создано, что уже было («Показать» - переход
 * к записи) и сколько адресов отброшено. extraInvalid - отброшенные ещё до запроса.
 * Нет ни созданных, ни повторов - все адреса были не ссылками.
 */
export function linksSummary(r: CreateLinksResponse, extraInvalid = 0): ToastSpec[] {
  const out: ToastSpec[] = [];
  const created = r.created.length;
  const existing = r.existing.length;
  const invalid = r.invalid.length + extraInvalid;
  const [first] = r.existing;
  // «Показать» ведёт к единственной уже имевшейся записи; из нескольких выбрать нечего
  const showId = existing === 1 || created === 0 ? first?.entryId : undefined;

  if (created > 0 && existing > 0) {
    out.push({ text: `Добавлено ссылок: ${created}, уже было: ${existing}`, kind: 'success', showId });
  } else if (created > 0) {
    out.push({ text: created === 1 ? 'Ссылка добавлена' : `Добавлено ссылок: ${created}`, kind: 'success' });
  } else if (existing > 0) {
    out.push({ text: existing === 1 ? 'Уже есть' : `Уже есть: ${existing}`, kind: 'info', showId });
  }
  if (invalid > 0) {
    out.push(
      created + existing === 0
        ? { text: 'Это не ссылка', kind: 'error' }
        : { text: `Пропущено некорректных: ${invalid}`, kind: 'info' },
    );
  }
  return out;
}

export interface BookmarksTotals {
  created: number;
  existing: number;
  invalid: number;
}

/** Итог импорта закладок (UF-20): создано N, уже было M, некорректных K. */
export function bookmarksSummary(t: BookmarksTotals): ToastSpec {
  if (t.created + t.existing + t.invalid === 0) return { text: 'В файле нет закладок', kind: 'info' };
  const parts = [`создано ${t.created}`];
  if (t.existing > 0) parts.push(`уже было ${t.existing}`);
  if (t.invalid > 0) parts.push(`некорректных ${t.invalid}`);
  return { text: `Закладки: ${parts.join(', ')}`, kind: t.created + t.existing > 0 ? 'success' : 'info' };
}

/**
 * Предупреждение при удалении (UF-10): папки и записи с вложениями уходят
 * вместе с содержимым. Пустая строка или строка с переводом строки в конце.
 */
export function deleteWarning(entries: readonly Pick<Entry, 'kind' | 'childCount'>[]): string {
  const folders = entries.some((e) => e.kind === 'folder');
  const attachments = entries.some((e) => e.kind !== 'folder' && e.childCount > 0);
  if (folders && attachments) return 'Папки и записи с вложениями удаляются вместе со всем содержимым.\n';
  if (folders) return 'Папки удаляются вместе со всем содержимым.\n';
  if (attachments) return 'Записи с вложениями удаляются вместе с вложениями.\n';
  return '';
}

/** Первая непустая строка описания: для карточки ссылки и всплывающих подсказок (UF-22). */
export function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t !== '') return t;
  }
  return '';
}
