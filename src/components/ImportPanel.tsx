import type { ImportProgress } from '../hooks/useImporter';
import { formatBytes, plural } from '../lib/format';

const PHASE_TEXT = {
  planning: 'Проверка совпадений имён…',
  deciding: 'Ждём решения по совпадениям…',
  uploading: '',
} as const;

/** Индикатор потокового импорта (UF-7). */
export function ImportPanel({ progress }: { progress: ImportProgress }) {
  const { phase, loaded, total, count, queued } = progress;
  const pct = phase === 'uploading' && total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  return (
    <div
      role="status"
      className="fixed bottom-12 left-4 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl"
    >
      <div className="flex items-center justify-between text-sm text-zinc-200">
        <span>Импорт: {plural(count, 'файл', 'файла', 'файлов')}</span>
        {queued > 0 && <span className="text-xs text-zinc-500">в очереди: {queued}</span>}
      </div>
      {PHASE_TEXT[phase] !== '' && <p className="mt-1 text-xs text-zinc-500">{PHASE_TEXT[phase]}</p>}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        {pct === null ? (
          <div
            className={`h-full w-full rounded-full ${
              phase === 'deciding' ? 'bg-zinc-600' : 'animate-pulse bg-accent'
            }`}
          />
        ) : (
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        )}
      </div>
      {pct !== null && (
        <div className="mt-1 flex justify-between text-xs tabular-nums text-zinc-500">
          <span>
            {formatBytes(loaded)} / {formatBytes(total)}
          </span>
          <span>{pct === 100 ? 'завершение…' : `${pct}%`}</span>
        </div>
      )}
    </div>
  );
}
