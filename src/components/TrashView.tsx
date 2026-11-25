import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mediaUrl, purgeTrash, restoreFromTrash } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import { invalidateContent, trashQuery } from '../api/queries';
import type { TrashEntry } from '../api/types';
import { isInteractiveTarget, isTypingTarget } from '../lib/dom';
import { formatBytes, formatDateTime, plural } from '../lib/format';
import { displayName } from '../lib/link';
import { isNavKey } from '../lib/selection';
import { useEvent, useWindowEvent } from '../hooks/useEvent';
import { useSelection } from '../hooks/useSelection';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import { glyphOf } from './EntryCard';
import { anyModalOpen } from './Modal';
import { useToast } from './Toasts';

const btn =
  'rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500 disabled:opacity-40 disabled:hover:border-zinc-700';

/** Где лежала запись: крошки до родителя. */
function locationText(e: TrashEntry): string {
  return ['Все объекты', ...e.location.map((p) => p.name)].join(' / ');
}

/** Сводка восстановления: сколько вернулось и кому пришлось сменить имя. */
export function restoreSummary(restored: number, renamed: readonly { name: string }[]): string {
  const head = `Восстановлено: ${plural(restored, 'объект', 'объекта', 'объектов')}`;
  if (renamed.length === 0) return head;
  const names = renamed
    .slice(0, 3)
    .map((r) => `«${r.name}»`)
    .join(', ');
  return `${head}\nИмя было занято, новое: ${names}${renamed.length > 3 ? ` и ещё ${renamed.length - 3}` : ''}`;
}

/**
 * Корзина (Ф2.5 на сервере): корни удалённого, недавно удалённые первыми.
 * Клик - выделить (Ctrl/Shift - несколько), «Восстановить» возвращает на прежнее
 * место, «Удалить навсегда» и «Очистить корзину» - с подтверждением.
 * Delete - удалить выделенное навсегда, Ctrl+A - выделить всё.
 */
export function TrashView({ onChanged }: { onChanged?: () => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const trash = useQuery(trashQuery);
  const entries = useMemo(() => trash.data?.entries ?? [], [trash.data]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const selection = useSelection(ids);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const total = trash.data?.total ?? 0;

  const restoreMut = useMutation({
    mutationFn: (list: number[]) => restoreFromTrash(list),
    onSuccess: (r) => {
      toast(restoreSummary(r.restored, r.renamed), 'success');
      selection.clear();
      onChanged?.();
      invalidateContent(qc);
    },
    onError: (e) => {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось восстановить'), 'error');
      invalidateContent(qc);
    },
  });

  const purgeMut = useMutation({
    mutationFn: (what: { ids: number[] } | { all: true }) => purgeTrash(what),
    onSuccess: (r) => {
      toast(`Удалено навсегда: ${plural(r.purged, 'объект', 'объекта', 'объектов')}`, 'success');
      selection.clear();
      onChanged?.();
      invalidateContent(qc);
    },
    onError: (e) => {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось удалить'), 'error');
      invalidateContent(qc);
    },
  });

  const busy = restoreMut.isPending || purgeMut.isPending;

  const askPurge = useEvent((list: number[]) => {
    if (list.length === 0 || busy) return;
    const [only] = entries.filter((e) => list.includes(e.id));
    setConfirm({
      title:
        list.length === 1 && only !== undefined
          ? `Удалить «${displayName(only)}» навсегда?`
          : `Удалить навсегда ${plural(list.length, 'объект', 'объекта', 'объектов')}?`,
      message: 'Вернуть будет нельзя. Папки удаляются вместе со всем содержимым.',
      confirmLabel: 'Удалить навсегда',
      danger: true,
      onConfirm: () => purgeMut.mutate({ ids: list }),
    });
  });

  const askEmpty = useEvent(() => {
    if (total === 0 || busy) return;
    setConfirm({
      title: 'Очистить корзину?',
      message: `Навсегда удалится ${plural(total, 'объект', 'объекта', 'объектов')} со всем содержимым. Вернуть будет нельзя.`,
      confirmLabel: 'Очистить',
      danger: true,
      onConfirm: () => purgeMut.mutate({ all: true }),
    });
  });

  const onRowClick = (e: MouseEvent, id: number) => {
    if (e.ctrlKey || e.metaKey) selection.toggle(id);
    else if (e.shiftKey) selection.extendTo(id);
    else selection.only(id);
  };

  useWindowEvent('keydown', (e) => {
    if (e.defaultPrevented || isTypingTarget(e.target) || anyModalOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete') {
      e.preventDefault();
      if (e.repeat) return;
      askPurge([...selection.selected]);
    } else if (e.key === 'Escape') {
      selection.clear();
    } else if (ctrl && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
      e.preventDefault();
      selection.selectAll();
    } else if (e.key === 'Enter' && !isInteractiveTarget(e.target) && selection.selected.size > 0) {
      e.preventDefault();
      if (!busy && !e.repeat) restoreMut.mutate([...selection.selected]);
    } else if (!ctrl && isNavKey(e.key)) {
      e.preventDefault();
      const id = selection.move(e.key, 1, e.shiftKey);
      if (id !== undefined) document.querySelector(`[data-trash-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  const selected = [...selection.selected];
  const active = selected.at(-1);

  return (
    <section aria-label="Корзина" className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <h2 className="mr-2 text-base font-medium text-zinc-100">Корзина</h2>
        <span className="text-xs text-zinc-500">
          {total === 0 ? 'пусто' : plural(total, 'объект', 'объекта', 'объектов')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className={btn}
          disabled={selected.length === 0 || busy}
          onClick={() => restoreMut.mutate(selected)}
        >
          Восстановить
        </button>
        <button
          type="button"
          className={btn}
          disabled={selected.length === 0 || busy}
          onClick={() => askPurge(selected)}
        >
          Удалить навсегда
        </button>
        <button
          type="button"
          className={`${btn} border-red-900 text-red-300 hover:border-red-700`}
          disabled={total === 0 || busy}
          onClick={askEmpty}
        >
          Очистить корзину
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onClick={(e) => {
          if (e.target === e.currentTarget) selection.clear();
        }}
      >
        {trash.isPending ? (
          <div className="flex h-64 items-center justify-center" aria-busy="true">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
          </div>
        ) : trash.isError ? (
          <p className="p-6 text-center text-sm text-red-400">{errorMessage(trash.error, 'Не удалось открыть корзину')}</p>
        ) : entries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <span className="text-4xl opacity-40">🗑</span>
            <p className="text-sm text-zinc-400">Корзина пуста</p>
            <p className="text-xs text-zinc-600">Удалённое лежит здесь, пока его не удалят навсегда</p>
          </div>
        ) : (
          <ul
            role="listbox"
            aria-multiselectable="true"
            aria-label="Удалённые объекты"
            tabIndex={0}
            aria-activedescendant={active === undefined ? undefined : `trash-row-${active}`}
            className="flex flex-col gap-0.5 outline-none"
          >
            {entries.map((e) => {
              const isSel = selection.selected.has(e.id);
              return (
                <li
                  key={e.id}
                  id={`trash-row-${e.id}`}
                  role="option"
                  aria-selected={isSel}
                  data-trash-id={e.id}
                  className={`flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 ${
                    isSel ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-zinc-800/60'
                  }`}
                  onClick={(ev) => onRowClick(ev, e.id)}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800 text-lg">
                    {e.hasThumbnail ? (
                      <img
                        src={mediaUrl(e.id, 'thumbnail')}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(ev) => {
                          ev.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      glyphOf(e)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{displayName(e)}</span>
                    <span className="block truncate text-xs text-zinc-500" title={locationText(e)}>
                      {locationText(e)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">
                    {e.kind === 'folder'
                      ? plural(e.childCount, 'объект', 'объекта', 'объектов')
                      : e.kind === 'link'
                        ? (e.domain ?? '')
                        : formatBytes(e.size)}
                  </span>
                  <span className="w-36 shrink-0 text-right text-xs tabular-nums text-zinc-500" title="Когда удалено">
                    {formatDateTime(e.trashedAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {total > entries.length && (
          <p className="p-3 text-center text-xs text-zinc-500">
            Показаны {entries.length} последних из {total}. «Очистить корзину» удалит все.
          </p>
        )}
      </div>

      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
