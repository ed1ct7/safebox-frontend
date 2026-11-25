import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isUnauthorized } from '../api/client';
import { loadTable, saveTableText, TableConflictError } from '../api/tables';
import type { TableBase } from '../api/tables';
import type { Entry } from '../api/types';
import { serializeTable } from '../lib/table';
import type { TableDoc } from '../lib/table';
import { useEvent } from './useEvent';

/** Пауза после последней правки до записи в сейф. */
export const TABLE_SAVE_DELAY_MS = 700;
const MAX_UNDO = 200;

export type TableLoad = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

export type TableSave =
  | { state: 'saved' }
  | { state: 'dirty' } // правка ждёт записи
  | { state: 'saving' }
  | { state: 'error'; message: string }
  | { state: 'conflict' }; // в сейфе другая версия: запись стоит, пока не решит пользователь

export interface TableDocHandle {
  load: TableLoad;
  /** null, пока не загружена */
  doc: TableDoc | null;
  save: TableSave;
  canUndo: boolean;
  canRedo: boolean;
  /** Правка: функция получает текущую таблицу; вернула её же - правки нет. */
  edit: (change: (doc: TableDoc) => TableDoc) => void;
  undo: () => void;
  redo: () => void;
  /** Дописать всё несохранённое сейчас; true - в сейфе то же, что на экране. */
  saveNow: () => Promise<boolean>;
  /** Конфликт: записать свою версию поверх чужой. */
  overwrite: () => Promise<boolean>;
  /** Перечитать из сейфа; несохранённое и история правок отбрасываются. */
  reload: () => void;
}

/**
 * Таблица одной записи: загрузка, правки с отменой и автосохранение. Сохраняется вся
 * таблица целиком через паузу после правки; запись идёт по одной, правка во время
 * записи уходит следующей. «Сохранено» значит, что сервер подтвердил запись.
 */
export function useTableDoc(
  id: number,
  opts: { onSaved?: (entry: Entry) => void; onLoaded?: (entry: Entry) => void } = {},
): TableDocHandle {
  const [load, setLoad] = useState<TableLoad>({ status: 'loading' });
  const [doc, setDoc] = useState<TableDoc | null>(null);
  const [save, setSave] = useState<TableSave>({ state: 'saved' });
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [reloads, setReloads] = useState(0);

  const docRef = useRef<TableDoc | null>(null);
  const base = useRef<TableBase | null>(null); // что лежит в сейфе
  const savedText = useRef(''); // serializeTable того, что в сейфе: с ним сравнивается экран
  const past = useRef<TableDoc[]>([]);
  const future = useRef<TableDoc[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inflight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false); // конфликт: автосохранение не пишет поверх чужого
  const alive = useRef(true);
  const onSaved = useEvent((entry: Entry) => opts.onSaved?.(entry));
  const onLoaded = useEvent((entry: Entry) => opts.onLoaded?.(entry));

  const isDirty = () => docRef.current !== null && serializeTable(docRef.current) !== savedText.current;

  const isDirtyNow = useEvent(isDirty);

  const show = (next: TableSave) => {
    if (alive.current) setSave(next);
  };

  const write = useEvent(async (force: boolean): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inflight.current !== null) await inflight.current;
    const current = docRef.current;
    const from = base.current;
    if (current === null || from === null) return true;
    const text = serializeTable(current);
    if (text === savedText.current) {
      if (!blocked.current) show({ state: 'saved' });
      return !blocked.current;
    }
    if (blocked.current && !force) return false;

    show({ state: 'saving' });
    const job = (async () => {
      try {
        const done = await saveTableText(id, text, from, { force });
        base.current = done.base;
        savedText.current = text;
        blocked.current = false;
        onSaved(done.entry);
        return true;
      } catch (e) {
        if (e instanceof TableConflictError) {
          blocked.current = true;
          show({ state: 'conflict' });
        } else if (!isUnauthorized(e)) {
          show({ state: 'error', message: errorMessage(e, 'Не удалось сохранить таблицу') });
        }
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = job;
    const ok = await job;
    if (ok) {
      // пока шла запись, таблицу правили дальше - это уйдёт следующей записью
      if (isDirty()) schedule();
      else show({ state: 'saved' });
    }
    return ok;
  });

  const schedule = useEvent(() => {
    clearTimeout(timer.current);
    if (blocked.current) return;
    show({ state: 'dirty' });
    timer.current = setTimeout(() => void write(false), TABLE_SAVE_DELAY_MS);
  });

  const commit = (next: TableDoc) => {
    docRef.current = next;
    setDoc(next);
    setHistory({ undo: past.current.length, redo: future.current.length });
    if (isDirty()) schedule();
    else if (!blocked.current && inflight.current === null) {
      clearTimeout(timer.current); // отмена вернула к сохранённому: писать нечего
      show({ state: 'saved' });
    }
  };

  const edit = useEvent((change: (doc: TableDoc) => TableDoc) => {
    const current = docRef.current;
    if (current === null) return;
    const next = change(current);
    if (next === current) return;
    past.current = [...past.current.slice(-(MAX_UNDO - 1)), current];
    future.current = [];
    commit(next);
  });

  const undo = useEvent(() => {
    const current = docRef.current;
    const prev = past.current.at(-1);
    if (current === null || prev === undefined) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, current];
    commit(prev);
  });

  const redo = useEvent(() => {
    const current = docRef.current;
    const next = future.current.at(-1);
    if (current === null || next === undefined) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, current];
    commit(next);
  });

  const saveNow = useEvent(async (): Promise<boolean> => {
    // правка могла прийти, пока шла запись: дописываем, пока экран и сейф не совпадут
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!(await write(false))) return false;
      if (!isDirty()) return true;
    }
    return !isDirty();
  });

  const overwrite = useEvent(() => write(true));

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let current = true;
    clearTimeout(timer.current);
    docRef.current = null;
    base.current = null;
    past.current = [];
    future.current = [];
    blocked.current = false;
    setDoc(null);
    setHistory({ undo: 0, redo: 0 });
    setSave({ state: 'saved' });
    setLoad({ status: 'loading' });
    loadTable(id).then(
      (loaded) => {
        if (!current) return;
        docRef.current = loaded.doc;
        base.current = loaded.base;
        savedText.current = serializeTable(loaded.doc);
        setDoc(loaded.doc);
        setLoad({ status: 'ready' });
        onLoaded(loaded.entry);
      },
      (e: unknown) => {
        if (!current || isUnauthorized(e)) return;
        setLoad({ status: 'error', message: errorMessage(e, 'Не удалось открыть таблицу') });
      },
    );
    return () => {
      current = false;
    };
  }, [id, reloads, onLoaded]);

  // закрытие экрана: начатая запись доходит до сервера сама, а правка, которая ещё
  // ждала паузы, уходит сразу (экран могли снять и без saveNow)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      if (!blocked.current && isDirtyNow()) void write(false);
    };
  }, [isDirtyNow, write]);

  // закрытие вкладки с несохранённой правкой - браузер переспросит
  useEffect(() => {
    if (save.state === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save.state]);

  return {
    load,
    doc,
    save,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    edit,
    undo,
    redo,
    saveNow,
    overwrite,
    reload,
  };
}
