import type { FolderNode, PathItem } from '../api/types';

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

/** Папка и все её предки (для раскрытия дерева до текущей папки). */
export function selfAndAncestors(nodes: FolderNode[], id: number): number[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const out: number[] = [];
  const seen = new Set<number>();
  for (let cur: number | null | undefined = id; cur != null && !seen.has(cur); cur = parentOf.get(cur)) {
    seen.add(cur);
    out.push(cur);
  }
  return out;
}

/**
 * UF-10: «удалённая открытая папка возвращает на родителя». path — крошки
 * открытой папки (от корня до неё включительно). Если удалена она сама или
 * любой предок — возвращаемся к родителю самой верхней удалённой папки
 * (null — корень). undefined — открытая папка цела, остаёмся.
 */
export function folderAfterDelete(
  path: readonly PathItem[],
  deleted: ReadonlySet<number>,
): number | null | undefined {
  const i = path.findIndex((p) => deleted.has(p.id));
  if (i === -1) return undefined;
  return i === 0 ? null : (path[i - 1]?.id ?? null);
}

/**
 * Записи и все их папки-потомки: сюда их перемещать нельзя (в себя или в своё
 * содержимое). Обходит только папки — вложения записей в дереве не показываются.
 */
export function subtreeIds(nodes: readonly FolderNode[], ids: readonly number[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = children.get(n.parentId);
    if (list === undefined) children.set(n.parentId, [n.id]);
    else list.push(n.id);
  }
  const out = new Set<number>();
  const stack = [...ids];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}
