import { describe, expect, it } from 'vitest';
import { buildTree } from './tree';
import type { FolderNode } from '../api/types';

describe('buildTree', () => {
  it('вкладывает детей в родителей', () => {
    const nodes: FolderNode[] = [
      { id: 1, parentId: null, name: 'Фото' },
      { id: 2, parentId: 1, name: '2023' },
      { id: 3, parentId: 1, name: '2024' },
      { id: 4, parentId: null, name: 'Видео' },
      { id: 5, parentId: 2, name: 'Январь' },
    ];
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.name)).toEqual(['Фото', 'Видео']);
    const photo = tree[0]!;
    expect(photo.children.map((c) => c.name)).toEqual(['2023', '2024']);
    expect(photo.children[0]!.children[0]!.name).toBe('Январь');
  });

  it('пустой список', () => {
    expect(buildTree([])).toEqual([]);
  });
});
