import type { FolderNode } from '../api/types';

export interface TreeNode {
  id: number;
  name: string;
  children: TreeNode[];
}

/** Плоский список (родители раньше детей) → дерево для сайдбара. */
export function buildTree(nodes: FolderNode[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const n of nodes) byId.set(n.id, { id: n.id, name: n.name, children: [] });

  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const node = byId.get(n.id);
    if (node === undefined) continue;
    if (n.parentId === null) {
      roots.push(node);
    } else {
      byId.get(n.parentId)?.children.push(node);
    }
  }
  return roots;
}
