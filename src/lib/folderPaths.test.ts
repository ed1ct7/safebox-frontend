import { describe, expect, it } from 'vitest';
import { findPathExact, folderPaths, normalizeNewPath, searchFolderPaths } from './folderPaths';

const folders = [
  { id: 1, parentId: null, name: 'Мемы' },
  { id: 2, parentId: 1, name: 'Животные' },
  { id: 3, parentId: 1, name: 'Ёлки' },
  { id: 4, parentId: null, name: 'Разное' },
  { id: 5, parentId: 4, name: 'Мемы старые' },
  { id: 6, parentId: 99, name: 'Сирота' },
];
const paths = folderPaths(folders);
const ids = (q: string) => searchFolderPaths(paths, q).map((p) => p.id);

describe('пути папок', () => {
  it('порядок дерева, полный путь; сирота - от корня', () => {
    expect(paths.map((p) => p.label)).toEqual([
      'Мемы',
      'Мемы / Ёлки',
      'Мемы / Животные',
      'Разное',
      'Разное / Мемы старые',
      'Сирота',
    ]);
  });

  it('цикл в данных не зацикливает', () => {
    const loop = folderPaths([
      { id: 1, parentId: 2, name: 'a' },
      { id: 2, parentId: 1, name: 'b' },
    ]);
    expect(loop).toEqual([]);
  });

  it('все слова запроса - где-то в пути; «ё» = «е», без регистра', () => {
    expect(ids('мем жив')).toEqual([2]);
    expect(ids('ЕЛКИ')).toEqual([3]);
    expect(ids('мемы/жив')).toEqual([2]);
    expect(ids('нет такого')).toEqual([]);
    expect(ids('  ')).toEqual([]);
  });

  it('совпадение в имени самой папки - выше, чем в пути к ней', () => {
    expect(ids('мемы')[0]).toBe(1);
    expect(ids('мемы').slice(1)).toEqual(expect.arrayContaining([5, 2, 3]));
    expect(ids('стар')).toEqual([5]);
  });

  it('новый путь: «/» и «\\», пробелы вокруг частей', () => {
    expect(normalizeNewPath(' Мемы / Коты ')).toBe('Мемы/Коты');
    expect(normalizeNewPath('a\\b//c')).toBe('a/b/c');
    expect(normalizeNewPath(' / ')).toBeNull();
    expect(findPathExact(paths, 'мемы/ЖИВОТНЫЕ')?.id).toBe(2);
    expect(findPathExact(paths, 'Мемы/Коты')).toBeUndefined();
  });
});
