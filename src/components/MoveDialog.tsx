import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import type { Entry } from '../api/types';
import { plural } from '../lib/format';
import { displayName } from '../lib/link';
import { canMoveTo } from '../lib/move';
import { buildTree, subtreeIds } from '../lib/tree';
import type { TreeNode } from '../lib/tree';
import { DialogPanel, Modal } from './Modal';

type Target = number | null | undefined; // undefined - ещё не выбрано, null - «Все объекты»

const rowClass = (selected: boolean, disabled: boolean) =>
  `flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-sm transition ${
    selected
      ? 'bg-accent/25 text-zinc-100'
      : disabled
        ? 'cursor-not-allowed text-zinc-600'
        : 'text-zinc-300 hover:bg-zinc-800'
  }`;

function PickerNodes({
  nodes,
  depth,
  target,
  expanded,
  isDisabled,
  onToggle,
  onPick,
}: {
  nodes: TreeNode[];
  depth: number;
  target: Target;
  expanded: ReadonlySet<number>;
  isDisabled: (id: number) => boolean;
  onToggle: (id: number) => void;
  onPick: (id: number) => void;
}) {
  return (
    <ul>
      {nodes.map((n) => {
        const open = expanded.has(n.id);
        const disabled = isDisabled(n.id);
        return (
          <li key={n.id}>
            <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
              {n.children.length > 0 ? (
                <button
                  type="button"
                  aria-label={open ? 'Свернуть' : 'Развернуть'}
                  aria-expanded={open}
                  className="w-5 shrink-0 text-center text-[10px] text-zinc-500 hover:text-zinc-200"
                  onClick={() => onToggle(n.id)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                type="button"
                disabled={disabled}
                aria-pressed={target === n.id}
                className={rowClass(target === n.id, disabled)}
                onClick={() => onPick(n.id)}
              >
                <span className="truncate">📁 {n.name}</span>
              </button>
            </div>
            {open && n.children.length > 0 && (
              <PickerNodes
                nodes={n.children}
                depth={depth + 1}
                target={target}
                expanded={expanded}
                isDisabled={isDisabled}
                onToggle={onToggle}
                onPick={onPick}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Переместить…» (UF-14): выбор нового родителя - «Все объекты» или папка дерева.
 * Недоступны сами перемещаемые папки с их содержимым и место, где записи уже лежат.
 * Записи-контейнеры выбираются перетаскиванием на карточку.
 */
export function MoveDialog({
  entries,
  onMove,
  onClose,
}: {
  entries: Entry[];
  onMove: (parentId: number | null) => void;
  onClose: () => void;
}) {
  const query = useQuery(foldersQuery);
  const folders = useMemo(() => query.data?.folders ?? [], [query.data]);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const blocked = useMemo(() => subtreeIds(folders, ids), [folders, ids]);
  const parentOf = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e.parentId]));
    return (id: number) => byId.get(id);
  }, [entries]);
  const [target, setTarget] = useState<Target>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const isDisabled = (id: number | null) => !canMoveTo(ids, id, blocked, parentOf);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [single] = entries;
  const title =
    entries.length === 1 && single !== undefined
      ? `Переместить «${displayName(single)}»`
      : `Переместить ${plural(entries.length, 'объект', 'объекта', 'объектов')}`;
  const rootDisabled = isDisabled(null);

  return (
    <Modal onClose={onClose} label={title}>
      <DialogPanel title={title}>
        <p className="mt-2 text-sm text-zinc-400">Выберите папку, в которую переместить.</p>
        <nav aria-label="Куда переместить" className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 p-1">
          <button
            type="button"
            disabled={rootDisabled}
            aria-pressed={target === null}
            className={`${rowClass(target === null, rootDisabled)} w-full`}
            onClick={() => setTarget(null)}
          >
            🗄 Все объекты
          </button>
          {query.isPending && <div className="px-2 py-1 text-xs text-zinc-600">Загрузка…</div>}
          {query.isError && (
            <div className="px-2 py-1 text-xs text-red-400">Не удалось загрузить папки</div>
          )}
          <PickerNodes
            nodes={tree}
            depth={0}
            target={target}
            expanded={expanded}
            isDisabled={isDisabled}
            onToggle={toggle}
            onPick={setTarget}
          />
        </nav>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={target === undefined}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
            onClick={() => {
              if (target === undefined) return;
              onClose();
              onMove(target);
            }}
          >
            Переместить
          </button>
        </div>
      </DialogPanel>
    </Modal>
  );
}
