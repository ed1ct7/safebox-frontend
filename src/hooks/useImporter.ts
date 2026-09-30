import { useCallback, useEffect, useRef, useState } from 'react';
import { importEntries, isAbortError, planImport } from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import type { ImportResult } from '../api/types';
import { importConflictItems } from '../lib/conflicts';
import { importSummary } from '../lib/format';
import { applyResolutions, buildManifest, planFiles } from '../lib/importPlan';
import type { Resolutions } from '../lib/importPlan';
import { useToast } from '../components/Toasts';
import type { AskConflicts } from './useConflictPrompt';
import { useEvent } from './useEvent';

export interface ImportProgress {
  /** planning - сверка с папкой; deciding - ждём решения по совпадениям; uploading - байты уходят */
  phase: 'planning' | 'deciding' | 'uploading';
  loaded: number;
  total: number;
  count: number; // файлов в текущей партии
  queued: number; // партий ждут своей очереди
}

interface Job {
  files: PendingFile[];
  folderId: number | null; // папка или запись, в чьи вложения импортируем
  source?: string; // «из «Загрузки»» в тосте — для наблюдения за папкой
}

const NO_RESOLUTIONS: Resolutions = new Map();

/**
 * Импорт (UF-7, UF-15) очередью: партии (кнопка, drag&drop, Ctrl+V, наблюдение за
 * папкой) уходят по одной — прогресс честный, а не перезаписывается чужой
 * партией. Перед отправкой партия сверяется с целевой папкой (planImport): нет
 * совпадений имён — сразу загрузка, есть — вопрос через askConflicts (отмена
 * снимает всю партию), пропущенные файлы на сервер не передаются. При
 * размонтировании (блокировка) текущая отправка обрывается, очередь сбрасывается.
 */
export function useImporter({
  onBatchDone,
  onActivity,
  askConflicts,
}: {
  onBatchDone: () => void;
  onActivity: () => void;
  askConflicts: AskConflicts;
}) {
  const toast = useToast();
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const batchDone = useEvent(onBatchDone);
  const activity = useEvent(onActivity);
  const ask = useEvent(askConflicts);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let job = queue.current.shift(); job !== undefined; job = queue.current.shift()) {
        const count = job.files.length;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const show = (phase: ImportProgress['phase'], loaded = 0, total = 0) =>
          setProgress({ phase, loaded, total, count, queued: queue.current.length });
        show('planning');
        try {
          const plan = await planImport(job.folderId, planFiles(job.files));
          if (ctrl.signal.aborted) return;

          let resolutions = NO_RESOLUTIONS;
          if (plan.conflicts.length > 0) {
            show('deciding');
            const answer = await ask({
              kind: 'import',
              items: importConflictItems(plan.conflicts, job.files),
            });
            if (ctrl.signal.aborted) return;
            if (answer === null) {
              toast('Импорт отменён', 'info');
              continue;
            }
            if (answer === 'rename-existing') continue; // кнопки нет при импорте - недостижимо
            resolutions = answer;
          }

          const { send, skipped } = applyResolutions(job.files, resolutions);
          let result: ImportResult = { imported: 0, replaced: 0, skipped: 0, failed: 0, failures: [] };
          if (send.length > 0) {
            show('uploading');
            result = await importEntries(job.folderId, send, {
              signal: ctrl.signal,
              manifest: buildManifest(send, resolutions),
              onProgress: (loaded, total) => {
                show('uploading', loaded, total);
                activity(); // долгий импорт = присутствие (UF-13)
              },
            });
          }
          const summary = importSummary(result, job.source, skipped);
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
  }, [toast, batchDone, activity, ask]);

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
