import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFolders } from '../api/endpoints';
import { buildTree } from '../lib/tree';
import type { TreeNode } from '../lib/tree';

function Nodes({
  nodes,
  depth,
  current,
  onNavigate,
}: {
  nodes: TreeNode[];
  depth: number;
  current: number | null;
  onNavigate: (id: number) => void;
}) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <button
            className={`block w-full truncate rounded-md py-1 pr-2 text-left text-sm transition ${
              current === n.id ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
            }`}
            style={{ paddingLeft: depth * 14 + 8 }}
            title={n.name}
            onClick={() => onNavigate(n.id)}
          >
            📁 {n.name}
          </button>
          {n.children.length > 0 && (
            <Nodes nodes={n.children} depth={depth + 1} current={current} onNavigate={onNavigate} />
          )}
        </div>
      ))}
    </>
  );
}

export function FolderTree({
  current,
  onNavigate,
}: {
  current: number | null;
  onNavigate: (id: number | null) => void;
}) {
  const foldersQuery = useQuery({ queryKey: ['folders'], queryFn: getFolders });
  const tree = useMemo(() => buildTree(foldersQuery.data?.folders ?? []), [foldersQuery.data]);

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      <button
        className={`block w-full truncate rounded-md px-2 py-1 text-left text-sm transition ${
          current === null ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
        }`}
        onClick={() => onNavigate(null)}
      >
        🗄 Все объекты
      </button>
      {foldersQuery.isPending && <div className="px-2 py-1 text-xs text-zinc-600">Загрузка…</div>}
      <Nodes nodes={tree} depth={1} current={current} onNavigate={onNavigate} />
    </nav>
  );
}
