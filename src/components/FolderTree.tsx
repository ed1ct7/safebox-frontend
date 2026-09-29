import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import { buildTree, selfAndAncestors } from '../lib/tree';
import type { TreeNode } from '../lib/tree';

const rowClass = (active: boolean) =>
  `flex w-full min-w-0 items-center rounded-md py-1 pr-2 text-left text-sm transition ${
    active ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
  }`;

function Nodes({
  nodes,
  depth,
  current,
  expanded,
  onToggle,
  onNavigate,
}: {
  nodes: TreeNode[];
  depth: number;
  current: number | null | undefined;
  expanded: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onNavigate: (id: number) => void;
}) {
  return (
    <ul>
      {nodes.map((n) => {
        const open = expanded.has(n.id);
        const hasChildren = n.children.length > 0;
        return (
          <li key={n.id}>
            <div className={rowClass(current === n.id)} style={{ paddingLeft: depth * 12 }}>
              {hasChildren ? (
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
                className="min-w-0 flex-1 truncate text-left"
                title={n.name}
                aria-current={current === n.id ? 'page' : undefined}
                onClick={() => onNavigate(n.id)}
              >
                📁 {n.name}
              </button>
            </div>
            {hasChildren && open && (
              <Nodes
                nodes={n.children}
                depth={depth + 1}
                current={current}
                expanded={expanded}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Дерево папок (UF-3): «Все объекты» + подпапки. Путь до открытой папки
 * раскрывается сам. current: null — корень, undefined — ничего (режим поиска).
 */
export function FolderTree({
  current,
  onNavigate,
}: {
  current: number | null | undefined;
  onNavigate: (id: number | null) => void;
}) {
  const query = useQuery(foldersQuery);
  const folders = useMemo(() => query.data?.folders ?? [], [query.data]);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (current === null || current === undefined) return;
    const path = selfAndAncestors(folders, current);
    setExpanded((prev) => (path.every((id) => prev.has(id)) ? prev : new Set([...prev, ...path])));
  }, [current, folders]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label="Папки" className="flex flex-col gap-0.5 px-2">
      <button
        type="button"
        className={`${rowClass(current === null)} px-2`}
        aria-current={current === null ? 'page' : undefined}
        onClick={() => onNavigate(null)}
      >
        🗄 Все объекты
      </button>
      {query.isPending && <div className="px-2 py-1 text-xs text-zinc-600">Загрузка…</div>}
      {query.isError && <div className="px-2 py-1 text-xs text-red-400">Не удалось загрузить папки</div>}
      <Nodes
        nodes={tree}
        depth={0}
        current={current}
        expanded={expanded}
        onToggle={toggle}
        onNavigate={onNavigate}
      />
    </nav>
  );
}
