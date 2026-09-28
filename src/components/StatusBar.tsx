import type { SafeInfo } from '../api/types';
import { plural } from '../lib/format';
import type { WatchStatus } from '../hooks/useWatchFolder';

/** UF-2: в статусбаре — количество объектов и путь сейфа. */
export function StatusBar({
  safe,
  isSearch,
  found,
  watch,
  onWatchResume,
  onWatchDisable,
}: {
  safe: SafeInfo | undefined;
  isSearch: boolean;
  found: number;
  watch: { status: WatchStatus; folderName: string };
  onWatchResume: () => void;
  onWatchDisable: () => void;
}) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-4 text-xs text-zinc-500">
      {safe !== undefined ? (
        <>
          <span className="shrink-0">{plural(safe.entryCount, 'объект', 'объекта', 'объектов')}</span>
          {isSearch && (
            <span className="shrink-0">
              · найдено: {plural(found, 'результат', 'результата', 'результатов')}
            </span>
          )}
          <span className="truncate" title={safe.path}>
            · {safe.path}
          </span>
        </>
      ) : (
        <span>SafeBox</span>
      )}

      {watch.status === 'active' && (
        <span
          className="ml-auto flex shrink-0 items-center gap-1.5 text-emerald-400"
          title={`Новые файлы из «${watch.folderName}» импортируются в сейф автоматически`}
        >
          👁 {watch.folderName}
          <button
            className="rounded px-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Отключить наблюдение"
            onClick={onWatchDisable}
          >
            ✕
          </button>
        </span>
      )}
      {watch.status === 'paused' && (
        <button
          className="ml-auto flex shrink-0 items-center gap-1.5 text-amber-400 transition hover:text-amber-300"
          title="Браузер просит подтвердить доступ к папке"
          onClick={onWatchResume}
        >
          👁 {watch.folderName} — возобновить
        </button>
      )}
    </footer>
  );
}
