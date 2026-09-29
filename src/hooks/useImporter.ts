import { useCallback, useEffect, useRef, useState } from 'react';
import { importEntries, isAbortError } from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import { importSummary } from '../lib/format';
import { useToast } from '../components/Toasts';
import { useEvent } from './useEvent';

export interface ImportProgress {
  loaded: number;
  total: number;
  count: number; // файлов в текущей партии
  queued: number; // партий ждут своей очереди
}

interface Job {
  files: PendingFile[];
  folderId: number | null;
  source?: string; // «из «Загрузки»» в тосте — для наблюдения за папкой
}

/**
 * Импорт (UF-7) очередью: партии (кнопка, drag&drop, Ctrl+V, наблюдение за
 * папкой) уходят по одной — прогресс честный, а не перезаписывается чужой
 * партией. Дубликаты отсеивает сервер (ImportResult.skipped). При размонтировании
 * (блокировка) текущая отправка обрывается, очередь сбрасывается.
 */
export function useImporter({
  onBatchDone,
  onActivity,
}: {
  onBatchDone: () => void;
  onActivity: () => void;
}) {
  const toast = useToast();
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const batchDone = useEvent(onBatchDone);
  const activity = useEvent(onActivity);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let job = queue.current.shift(); job !== undefined; job = queue.current.shift()) {
        const count = job.files.length;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setProgress({ loaded: 0, total: 0, count, queued: queue.current.length });
        try {
          const r = await importEntries(job.folderId, job.files, {
            signal: ctrl.signal,
            onProgress: (loaded, total) => {
              setProgress({ loaded, total, count, queued: queue.current.length });
              activity(); // долгий импорт = присутствие (UF-13)
            },
          });
          const summary = importSummary(r, job.source);
          toast(summary.text, summary.kind);
        } catch (e) {
          if (isAbortError(e) || isUnauthorized(e)) return; // блокировка: экран входа
          toast(errorMessage(e, 'Ошибка импорта'), 'error');
        } finally {
          batchDone(); // даже при ошибке часть файлов могла импортироваться
        }
      }
    } finally {
      running.current = false;
      abortRef.current = null;
      setProgress(null);
    }
  }, [toast, batchDone, activity]);

  const enqueue = useCallback(
    (files: PendingFile[], folderId: number | null, source?: string) => {
      if (files.length === 0) return;
      queue.current.push({ files, folderId, source });
      setProgress((p) => (p === null ? p : { ...p, queued: queue.current.length }));
      void pump();
    },
    [pump],
  );

  const cancelAll = useCallback(() => {
    queue.current = [];
    abortRef.current?.abort();
  }, []);

  useEffect(() => cancelAll, [cancelAll]);

  return { progress, enqueue, cancelAll };
}
