import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import type { Entry } from '../api/types';
import { foldForSearch } from '../lib/fold';
import { findPathExact, folderPaths, normalizeNewPath, queryTokens, searchFolderPaths } from '../lib/folderPaths';
import type { FolderPath } from '../lib/folderPaths';
import { plural } from '../lib/format';
import { displayName } from '../lib/link';
import { canMoveTo } from '../lib/move';
import { isPlacesFull, placeDigit } from '../lib/places';
import type { Places } from '../lib/places';
import { subtreeIds } from '../lib/tree';
import { Modal } from './Modal';

const ALL_LIMIT = 400; // без запроса - столько папок списком, дальше - «уточните»
const ROOT_LABEL = 'Все объекты';

type Row =
  | {
      key: string;
      kind: 'target';
      id: number | null; // null - «Все объекты»
      label: string; // что показать
      title: string; // полный путь
      depth: number; // отступ в списке «Все папки»
      section?: string; // заголовок над строкой
      disabled: boolean;
    }
  | { key: 'create'; kind: 'create'; path: string; section?: string; disabled: false };

export function movePaletteTitle(entries: readonly Entry[]): string {
  const [single] = entries;
  return entries.length === 1 && single !== undefined
    ? `Переместить «${displayName(single)}»`
    : `Переместить ${plural(entries.length, 'объект', 'объекта', 'объектов')}`;
}

/**
 * «Переместить в…» (M): поиск папки по пути («мем жив» -> Мемы / Животные), сверху
 * «Места» (цифры 1–9) и недавние. Enter - переместить, ☆ - в «Места» или из них;
 * пути нет - «Создать папку … и переместить» (путь от корня через «/»).
 * Недоступны сами перемещаемые папки с содержимым и место, где записи уже лежат.
 */
export function MovePalette({
  entries,
  places,
  recent,
  onTogglePlace,
  onMove,
  onCreate,
  onClose,
}: {
  entries: Entry[];
  places: Places;
  recent: readonly number[];
  onTogglePlace: (id: number) => void;
  /** выбрана папка; палитру закрывает вызывающий */
  onMove: (parentId: number | null) => void;
  /** создать папку по пути от корня и переместить в неё; палитру закрывает вызывающий */
  onCreate: (path: string) => void;
  /** отказ: Esc, клик мимо */
  onClose: () => void;
}) {
  const query = useQuery(foldersQuery);
  const folders = useMemo(() => query.data?.folders ?? [], [query.data]);
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const byId = useMemo(() => new Map(paths.map((p) => [p.id, p])), [paths]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const blocked = useMemo(() => subtreeIds(folders, ids), [folders, ids]);
  const parentOf = useMemo(() => {
    const m = new Map(entries.map((e) => [e.id, e.parentId]));
    return (id: number) => m.get(id);
  }, [entries]);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const here = (id: number | null) => entries.every((e) => e.parentId === id);

  const rows = useMemo<Row[]>(() => {
    const disabled = (id: number | null) => !canMoveTo(ids, id, blocked, parentOf);
    const target = (p: FolderPath | null, section: string | undefined, key: string, tree = false): Row => ({
      key,
      kind: 'target',
      id: p === null ? null : p.id,
      label: p === null ? ROOT_LABEL : tree ? p.name : p.label,
      title: p === null ? ROOT_LABEL : p.label,
      depth: tree && p !== null ? p.names.length : 0,
      section,
      disabled: disabled(p === null ? null : p.id),
    });
    const out: Row[] = [];
    const q = text.trim();
    if (q === '') {
      let first = true;
      places.forEach((id) => {
        const p = id === null ? undefined : byId.get(id);
        if (p === undefined) return;
        out.push(target(p, first ? 'Места' : undefined, `place-${p.id}`));
        first = false;
      });
      first = true;
      for (const id of recent) {
        const p = byId.get(id);
        if (p === undefined || places.includes(id)) continue;
        out.push(target(p, first ? 'Недавние' : undefined, `recent-${id}`));
        first = false;
      }
      out.push(target(null, 'Все папки', 'root', true));
      for (const p of paths.slice(0, ALL_LIMIT)) out.push(target(p, undefined, `all-${p.id}`, true));
      return out;
    }
    const tokens = queryTokens(q);
    const root = foldForSearch(ROOT_LABEL);
    if (tokens.length > 0 && tokens.every((t) => root.includes(t))) out.push(target(null, undefined, 'root'));
    for (const p of searchFolderPaths(paths, q)) out.push(target(p, undefined, `hit-${p.id}`));
    const newPath = normalizeNewPath(q);
    if (newPath !== null && findPathExact(paths, newPath) === undefined) {
      out.push({ key: 'create', kind: 'create', path: newPath, disabled: false });
    }
    return out;
  }, [text, paths, byId, places, recent, blocked, parentOf, ids]);

  // активная - первая доступная строка после каждого нового запроса
  useEffect(() => {
    const i = rows.findIndex((r) => !r.disabled);
    setActive(i < 0 ? 0 : i);
  }, [rows]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  // закрывает палитру тот, кто перемещает: onClose - только отказ
  const choose = (row: Row | undefined) => {
    if (row === undefined || row.disabled) return;
    if (row.kind === 'create') onCreate(row.path);
    else onMove(row.id);
  };

  const step = (delta: number) => {
    if (rows.length === 0) return;
    let i = active;
    for (let n = 0; n < rows.length; n += 1) {
      i = (i + delta + rows.length) % rows.length;
      if (!rows[i]?.disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) choose(rows[active]);
    }
  };

  const title = movePaletteTitle(entries);
  const full = isPlacesFull(places);
  const hiddenCount = text.trim() === '' ? Math.max(0, paths.length - ALL_LIMIT) : 0;

  return (
    <Modal onClose={onClose} label={title} className="flex items-start justify-center bg-black/60 p-4 pt-[12vh]">
      <div className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-4 pb-2 pt-3">
          <div className="truncate text-xs text-zinc-500">{title}</div>
          <input
            type="text"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="move-palette-list"
            aria-label="Папка назначения"
            placeholder="Куда переместить: начните вводить путь (мем жив → Мемы / Животные)"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            className="mt-1 w-full bg-transparent text-base text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div ref={listRef} id="move-palette-list" role="listbox" aria-label="Папки" className="min-h-0 flex-1 overflow-y-auto p-1">
          {query.isPending && <div className="px-3 py-2 text-xs text-zinc-600">Загрузка папок…</div>}
          {query.isError && <div className="px-3 py-2 text-xs text-red-400">Не удалось загрузить папки</div>}
          {!query.isPending && rows.length === 0 && (
            <div className="px-3 py-2 text-sm text-zinc-500">Ничего не найдено</div>
          )}
          {rows.map((row, i) => {
            const isActive = i === active;
            const digit = row.kind === 'target' && row.id !== null ? placeDigit(places, row.id) : undefined;
            return (
              <div key={row.key}>
                {row.section !== undefined && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-zinc-600">{row.section}</div>
                )}
                <div
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={row.disabled}
                  data-active={isActive}
                  title={row.kind === 'target' ? row.title : undefined}
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm ${
                    row.disabled
                      ? 'cursor-not-allowed text-zinc-600'
                      : isActive
                        ? 'bg-accent/25 text-zinc-100'
                        : 'text-zinc-300'
                  }`}
                  style={row.kind === 'target' && row.depth > 0 ? { paddingLeft: 8 + (row.depth - 1) * 14 } : undefined}
                  onMouseMove={() => {
                    if (!row.disabled && !isActive) setActive(i);
                  }}
                  onClick={() => choose(row)}
                >
                  {row.kind === 'create' ? (
                    <span className="min-w-0 flex-1 truncate">
                      ＋ Создать папку «{row.path.split('/').join(' / ')}» и переместить
                    </span>
                  ) : (
                    <>
                      <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-zinc-500">
                        {digit ?? ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {row.id === null ? '🗄' : '📁'} {row.label}
                      </span>
                      {row.disabled && here(row.id) && <span className="shrink-0 text-xs text-zinc-600">здесь</span>}
                      {row.id !== null && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={digit !== undefined ? `Убрать из «Мест» (${digit})` : 'Добавить в «Места»'}
                          title={
                            digit !== undefined
                              ? `Место ${digit} - убрать`
                              : full
                                ? 'Все 9 мест заняты'
                                : 'В «Места»: цифра 1–9 будет перемещать сюда'
                          }
                          disabled={digit === undefined && full}
                          className={`shrink-0 rounded px-1 text-sm transition hover:bg-zinc-700 disabled:opacity-30 ${
                            digit !== undefined ? 'text-amber-400' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                          } ${isActive ? 'opacity-100' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (row.id !== null) onTogglePlace(row.id);
                          }}
                        >
                          {digit !== undefined ? '★' : '☆'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="px-3 py-2 text-xs text-zinc-600">Ещё {hiddenCount} — начните вводить имя</div>
          )}
        </div>
        <div className="flex gap-4 border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">
          <span>↑↓ выбрать</span>
          <span>Enter — переместить</span>
          <span>☆ — в «Места» (цифры 1–9)</span>
          <span className="ml-auto">Esc</span>
        </div>
      </div>
    </Modal>
  );
}
