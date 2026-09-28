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
const KNOWN_KEY = 'watch:known';

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

  const poll = useCallback(async () => {
    const dir = dirRef.current;
    if (dir === null) return;
    try {
      const entries = await listWatchEntries(dir);
      const { toImport, state } = processPoll(
        entries.map((e) => e.wf),
        stateRef.current,
      );
      stateRef.current = state;
      const persisted: PersistedKnown = {
        known: [...state.known],
        baselineDone: state.baselineDone,
      };
      void idbSet(KNOWN_KEY, persisted);
      if (toImport.length > 0) {
        const byFp = new Map(entries.map((e) => [fpOf(e.wf), e]));
        const picked = toImport
          .map((wf) => byFp.get(fpOf(wf)))
          .filter((e): e is WatchEntry => e !== undefined);
        if (picked.length > 0) onNewRef.current(picked, dir.name);
      }
    } catch {
      // доступ потерян — оставляем тик, следующий может пройти
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
    const dir =
      dirRef.current ??
      ((await idbGet<WatchDirHandle>(DIR_KEY)) as WatchDirHandle | null) ??
      null;
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
    void (async () => {
      const dir = (await idbGet<WatchDirHandle>(DIR_KEY)) as WatchDirHandle | null;
      if (dir === null || dir.kind !== 'directory') return;
      const perm = await permissionOf(dir);
      if (perm === 'granted') {
        const saved = await idbGet<PersistedKnown>(KNOWN_KEY);
        start(dir, saved);
      } else {
        dirRef.current = dir;
        setFolderName(dir.name);
        setStatus('paused');
      }
    })();
    return stopTimer;
  }, [start, stopTimer]);

  return { status, folderName, enable, disable, resume };
}
