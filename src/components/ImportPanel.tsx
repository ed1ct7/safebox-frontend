import { plural } from '../lib/format';

/** Индикатор потокового импорта (UF-7). */
export function ImportPanel({
  loaded,
  total,
  count,
}: {
  loaded: number;
  total: number;
  count: number;
}) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl">
      <div className="flex items-center justify-between text-sm text-zinc-200">
        <span>Импорт…</span>
        <span className="text-xs text-zinc-500">{plural(count, 'файл', 'файла', 'файлов')}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        {pct === null ? (
          <div className="h-full w-full animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {pct !== null && (
        <div className="mt-1 text-right text-xs text-zinc-500">{pct}%</div>
      )}
    </div>
  );
}
