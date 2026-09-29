import { describe, expect, it } from 'vitest';
import { canMoveTo, dragIdsFor } from './move';

describe('dragIdsFor', () => {
  const visible = [1, 2, 3, 4, 5];

  it('невыделенная карточка - тащим только её, выделение не трогаем', () => {
    expect(dragIdsFor(visible, new Set([2, 3]), 5)).toEqual([5]);
    expect(dragIdsFor(visible, new Set(), 4)).toEqual([4]);
  });

  it('выделенная - все выделенные в порядке карточек', () => {
    expect(dragIdsFor(visible, new Set([4, 2, 3]), 3)).toEqual([2, 3, 4]);
  });
});

describe('canMoveTo', () => {
  const parents = new Map<number, number | null>([
    [1, null],
    [2, 10],
    [3, 10],
  ]);
  const parentOf = (id: number) => parents.get(id);
  const none = new Set<number>();

  it('нечего перемещать', () => {
    expect(canMoveTo([], 5, none, parentOf)).toBe(false);
  });

  it('в себя и в свою подпапку (blocked) нельзя', () => {
    expect(canMoveTo([1], 1, new Set([1, 7]), parentOf)).toBe(false);
    expect(canMoveTo([1], 7, new Set([1, 7]), parentOf)).toBe(false);
    expect(canMoveTo([1], 8, new Set([1, 7]), parentOf)).toBe(true);
  });

  it('туда, где все уже лежат, - нечего перемещать', () => {
    expect(canMoveTo([2, 3], 10, none, parentOf)).toBe(false);
    expect(canMoveTo([1], null, none, parentOf)).toBe(false);
  });

  it('хоть одна запись меняет родителя - можно', () => {
    expect(canMoveTo([1, 2], 10, none, parentOf)).toBe(true);
    expect(canMoveTo([2], null, none, parentOf)).toBe(true);
  });

  it('корень - обычная цель, blocked к нему не относится', () => {
    expect(canMoveTo([2], null, new Set([2]), parentOf)).toBe(true);
  });
});
