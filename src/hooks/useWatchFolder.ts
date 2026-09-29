import { useCallback, useEffect, useRef, useState } from 'react';
import { idbDel, idbGet, idbSet } from '../lib/idb';
import {
  listWatchEntries,
  permissionOf,
  pickWatchDirectory,
  requestReadPermission,
} from '../lib/fsAccess';
import type { WatchDirHandle, WatchEntry } from '../lib/fsAccess';
import { EMPTY_WATCH, fpOf, processPoll } from '../lib/watch';
import type { WatchState } from '../lib/watch';

const POLL_MS = 4000;

const DIR_KEY = 'watch:dir';
// v2: отпечатки — хеши (lib/watch fpOf). Нет v2 → новый baseline: существующие
// файлы помечаются известными, а не импортируются заново.
const KNOWN_KEY = 'watch:known:v2';
// v1 хранил имена файлов открытым текстом вне сейфа — стираем при первом запуске
const LEGACY_KNOWN_KEY = 'watch:known';

interface PersistedKnown {
  known: string[];
  baselineDone: boolean;
}

export type WatchStatus = 'off' | 'active' | 'paused'; // paused = нужно разрешение

/**
 * Наблюдение за папкой загрузок: новые стабильные файлы уходят в сейф
 * автоматически (в текущую открытую папку). Хендл папки и отпечатки
 * переживают перезагрузку вкладки; после блокировки сейфа наблюдение
 * умирает вместе с сессией — это осознанно.
 */
export function useWatchFolder(
  onNewEntries: (entries: WatchEntry[], folderName: string) => void,
) {
  const [status, setStatus] = useState<WatchStatus>('off');
  const [folderName, setFolderName] = useState('');
  const dirRef = useRef<WatchDirHandle | null>(null);
  const stateRef = useRef<WatchState>(EMPTY_WATCH);
  const timerRef = useRef<number | null>(null);
  const onNewRef = useRef(onNewEntries);
  onNewRef.current = onNewEntries;

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const polling = useRef(false);

  const poll = useCallback(async () => {
    const dir = dirRef.current;
    // большая папка читается дольше интервала: два опроса поверх одного
    // состояния импортировали бы один и тот же файл дважды
    if (dir === null || polling.current) return;
    polling.current = true;
    try {
      const entries = await listWatchEntries(dir);
      if (dirRef.current !== dir) return; // наблюдение выключили, пока читали папку
      const prev = stateRef.current;
      const { toImport, state } = processPoll(
        entries.map((e) => e.wf),
        prev,
      );
      stateRef.current = state;
      if (state.known.size !== prev.known.size || state.baselineDone !== prev.baselineDone) {
        const persisted: PersistedKnown = {
          known: [...state.known],
          baselineDone: state.baselineDone,
        };
        void idbSet(KNOWN_KEY, persisted);
      }
      if (toImport.length > 0) {
        const byFp = new Map(entries.map((e) => [fpOf(e.wf), e]));
        const picked = toImport
          .map((wf) => byFp.get(fpOf(wf)))
          .filter((e): e is WatchEntry => e !== undefined);
        if (picked.length > 0) onNewRef.current(picked, dir.name);
      }
    } catch {
      // доступ потерян — оставляем тик, следующий может пройти
    } finally {
      polling.current = false;
    }
  }, []);

  const start = useCallback(
    (dir: WatchDirHandle, persisted?: PersistedKnown) => {
      dirRef.current = dir;
      setFolderName(dir.name);
      stateRef.current =
        persisted === undefined
          ? { known: new Set(), sightings: new Map(), baselineDone: false }
          : { known: new Set(persisted.known), sightings: new Map(), baselineDone: persisted.baselineDone };
      setStatus('active');
      stopTimer();
      timerRef.current = window.setInterval(() => void poll(), POLL_MS);
      void poll();
    },
    [poll, stopTimer],
  );

  /** Из пункта меню «Следить за папкой…» — вызывается из клика. */
  const enable = useCallback(async () => {
    const dir = await pickWatchDirectory();
    if (dir === null) return false;
    await idbSet(DIR_KEY, dir);
    await idbDel(KNOWN_KEY);
    start(dir); // с чистого baseline: существующие файлы не импортируются
    return true;
  }, [start]);

  const disable = useCallback(async () => {
    stopTimer();
    dirRef.current = null;
    stateRef.current = EMPTY_WATCH;
    setStatus('off');
    setFolderName('');
    await idbDel(DIR_KEY);
    await idbDel(KNOWN_KEY);
  }, [stopTimer]);

  /** Клик по жёлтому чипу «возобновить» (жест для requestPermission). */
  const resume = useCallback(async () => {
    const dir = dirRef.current ?? (await idbGet<WatchDirHandle>(DIR_KEY)) ?? null;
    if (dir === null) {
      setStatus('off');
      return;
    }
    const perm = await requestReadPermission(dir);
    if (perm === 'granted') {
      const saved = await idbGet<PersistedKnown>(KNOWN_KEY);
      start(dir, saved);
    }
  }, [start]);

  // автопродолжение после перезагрузки вкладки (если разрешение живо)
  useEffect(() => {
    let cancelled = false; // размонтировали (блокировка) раньше, чем прочитали IndexedDB
    void (async () => {
      void idbDel(LEGACY_KNOWN_KEY);
      const dir = await idbGet<WatchDirHandle>(DIR_KEY);
      if (cancelled || dir === undefined || dir === null || dir.kind !== 'directory') return;
      const perm = await permissionOf(dir);
      if (cancelled) return;
      if (perm === 'granted') {
        const saved = await idbGet<PersistedKnown>(KNOWN_KEY);
        if (!cancelled) start(dir, saved);
      } else {
        dirRef.current = dir;
        setFolderName(dir.name);
        setStatus('paused');
      }
    })();
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [start, stopTimer]);

  return { status, folderName, enable, disable, resume };
}
