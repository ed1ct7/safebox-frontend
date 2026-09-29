import { describe, expect, it } from 'vitest';
import { buildTree, folderAfterDelete, selfAndAncestors } from './tree';
import type { FolderNode } from '../api/types';

const nodes: FolderNode[] = [
  { id: 1, parentId: null, name: 'Фото' },
  { id: 2, parentId: 1, name: '2023' },
  { id: 3, parentId: 1, name: '2024' },
  { id: 4, parentId: null, name: 'Видео' },
  { id: 5, parentId: 2, name: 'Январь' },
];

describe('buildTree', () => {
  it('вкладывает детей в родителей', () => {
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

describe('selfAndAncestors', () => {
  it('от папки до корня', () => {
    expect(selfAndAncestors(nodes, 5)).toEqual([5, 2, 1]);
    expect(selfAndAncestors(nodes, 4)).toEqual([4]);
  });

  it('неизвестная папка — только она сама', () => {
    expect(selfAndAncestors(nodes, 99)).toEqual([99]);
  });
});

describe('folderAfterDelete', () => {
  const path = [
    { id: 1, name: 'Фото' },
    { id: 2, name: '2023' },
    { id: 5, name: 'Январь' },
  ];

  it('открытая папка цела — остаёмся', () => {
    expect(folderAfterDelete(path, new Set([3, 4]))).toBeUndefined();
  });

  it('удалена открытая папка — на родителя', () => {
    expect(folderAfterDelete(path, new Set([5]))).toBe(2);
  });

  it('удалён предок — к родителю самого верхнего удалённого', () => {
    expect(folderAfterDelete(path, new Set([2, 5]))).toBe(1);
    expect(folderAfterDelete(path, new Set([1]))).toBeNull();
  });

  it('в корне удалять нечего', () => {
    expect(folderAfterDelete([], new Set([1]))).toBeUndefined();
  });
});
