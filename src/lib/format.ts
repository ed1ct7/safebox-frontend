import type { ImportResult } from '../api/types';

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

/** Тост по итогам импорта (UF-7): «Импортировано: N» + ошибки и пропущенные дубликаты. */
export function importSummary(
  r: ImportResult,
  source?: string,
): { text: string; kind: 'success' | 'error' | 'info' } {
  const from = source === undefined || source === '' ? '' : ` из «${source}»`;
  if (r.imported === 0 && r.failed === 0) {
    return r.skipped > 0
      ? { text: `Уже в сейфе${from}: ${plural(r.skipped, 'дубликат', 'дубликата', 'дубликатов')}`, kind: 'info' }
      : { text: `Нечего импортировать${from}`, kind: 'info' };
  }
  const parts = [`Импортировано${from}: ${r.imported}`];
  if (r.failed > 0) parts.push(`ошибок: ${r.failed}`);
  if (r.skipped > 0) parts.push(`дубликатов пропущено: ${r.skipped}`);
  let text = parts.join(', ');
  const first = r.failures[0];
  if (first !== undefined) text += `\n${first.path}: ${first.message}`;
  return { text, kind: r.failed > 0 ? 'error' : 'success' };
}
