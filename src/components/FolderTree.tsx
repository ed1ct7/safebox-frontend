import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import { useEntryDrop } from '../hooks/useEntryDrop';
import { buildTree, selfAndAncestors } from '../lib/tree';
import type { TreeNode } from '../lib/tree';

/** Приём перетаскиваемых карточек узлами дерева (UF-14); null - «Все объекты». */
export interface TreeDrop {
  canDrop: (target: number | null) => boolean;
  onDrop: (target: number | null) => void;
}

/** Правый клик по узлу (null - «Все объекты»), цифра «Места» у папки, подсветка узла под меню. */
export interface TreeExtras {
  onContextMenu?: (e: MouseEvent, id: number | null) => void;
  placeOf?: (id: number) => number | undefined;
  /** у какого узла открыто меню (undefined - ни у какого) */
  menuFor?: number | null;
}

const rowClass = (active: boolean, over = false) =>
  `flex w-full min-w-0 items-center rounded-md py-1 pr-2 text-left text-sm transition ${
    over
      ? 'bg-accent/30 text-zinc-100 ring-1 ring-accent'
      : active
        ? 'bg-accent/20 text-zinc-100'
        : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
  }`;

function TreeRow({
  node,
  depth,
  active,
  open,
  onToggle,
  onNavigate,
  dnd,
  extra,
}: {
  node: TreeNode;
  depth: number;
  active: boolean;
  open: boolean;
  onToggle: (id: number) => void;
  onNavigate: (id: number) => void;
  dnd: TreeDrop | undefined;
  extra: TreeExtras;
}) {
  const digit = extra.placeOf?.(node.id);
  const drop = useEntryDrop(
    () => dnd?.canDrop(node.id) ?? false,
    () => dnd?.onDrop(node.id),
  );
  return (
    <div
      className={rowClass(active, drop.over || extra.menuFor === node.id)}
      style={{ paddingLeft: depth * 12 }}
      onContextMenu={(e) => extra.onContextMenu?.(e, node.id)}
      {...drop.props}
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          aria-label={open ? 'Свернуть' : 'Развернуть'}
          aria-expanded={open}
          className="w-5 shrink-0 text-center text-[10px] text-zinc-500 hover:text-zinc-200"
          onClick={() => onToggle(node.id)}
        >
          {open ? '▾' : '▸'}
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        title={node.name}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(node.id)}
      >
        📁 {node.name}
      </button>
      {digit !== undefined && (
        <span
          className="ml-1 shrink-0 rounded bg-zinc-800 px-1 text-[10px] tabular-nums leading-4 text-zinc-400"
          title={`Место ${digit}: цифра ${digit} перемещает сюда`}
        >
          {digit}
        </span>
      )}
    </div>
  );
}

function Nodes({
  nodes,
  depth,
  current,
  expanded,
  onToggle,
  onNavigate,
  dnd,
  extra,
}: {
  nodes: TreeNode[];
  depth: number;
  current: number | null | undefined;
  expanded: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onNavigate: (id: number) => void;
  dnd: TreeDrop | undefined;
  extra: TreeExtras;
}) {
  return (
    <ul>
      {nodes.map((n) => {
        const open = expanded.has(n.id);
        return (
          <li key={n.id}>
            <TreeRow
              node={n}
              depth={depth}
              active={current === n.id}
              open={open}
              onToggle={onToggle}
              onNavigate={onNavigate}
              dnd={dnd}
              extra={extra}
            />
            {n.children.length > 0 && open && (
              <Nodes
                nodes={n.children}
                depth={depth + 1}
                current={current}
                expanded={expanded}
                onToggle={onToggle}
                onNavigate={onNavigate}
                dnd={dnd}
                extra={extra}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RootRow({
  active,
  onNavigate,
  dnd,
  extra,
}: {
  active: boolean;
  onNavigate: (id: null) => void;
  dnd: TreeDrop | undefined;
  extra: TreeExtras;
}) {
  const drop = useEntryDrop(
    () => dnd?.canDrop(null) ?? false,
    () => dnd?.onDrop(null),
  );
  return (
    <button
      type="button"
      className={`${rowClass(active, drop.over || extra.menuFor === null)} px-2`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(null)}
      onContextMenu={(e) => extra.onContextMenu?.(e, null)}
      {...drop.props}
    >
      🗄 Все объекты
    </button>
  );
}

/**
 * Дерево папок (UF-3): «Все объекты» + подпапки. Путь до открытой папки
 * раскрывается сам. current: null — корень, undefined — ничего (режим поиска).
 * expandPath - крошки открытого места: у открытых вложений записи раскрывается
 * дерево до папки, в которой она лежит.
 */
export function FolderTree({
  current,
  expandPath,
  onNavigate,
  dnd,
  onContextMenu,
  placeOf,
  menuFor,
}: {
  current: number | null | undefined;
  expandPath?: readonly number[];
  onNavigate: (id: number | null) => void;
  dnd?: TreeDrop;
} & TreeExtras) {
  const extra = useMemo<TreeExtras>(() => ({ onContextMenu, placeOf, menuFor }), [onContextMenu, placeOf, menuFor]);
  const query = useQuery(foldersQuery);
  const folders = useMemo(() => query.data?.folders ?? [], [query.data]);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    const ids = new Set(expandPath);
    if (current !== null && current !== undefined) {
      for (const id of selfAndAncestors(folders, current)) ids.add(id);
    }
    setExpanded((prev) => ([...ids].every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [current, expandPath, folders]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label="Папки" className="flex flex-col gap-0.5 px-2">
      <RootRow active={current === null} onNavigate={onNavigate} dnd={dnd} extra={extra} />
      {query.isPending && <div className="px-2 py-1 text-xs text-zinc-600">Загрузка…</div>}
      {query.isError && <div className="px-2 py-1 text-xs text-red-400">Не удалось загрузить папки</div>}
      <Nodes
        nodes={tree}
        depth={0}
        current={current}
        expanded={expanded}
        onToggle={toggle}
        onNavigate={onNavigate}
        dnd={dnd}
        extra={extra}
      />
    </nav>
  );
}
