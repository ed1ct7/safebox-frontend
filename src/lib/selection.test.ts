import { describe, expect, it } from 'vitest';
import { pruneSelection, rangeBetween, stepIndex } from './selection';

describe('pruneSelection', () => {
  it('убирает невидимые записи', () => {
    const sel = new Set([1, 2, 3]);
    expect([...pruneSelection(sel, [2, 3, 4])]).toEqual([2, 3]);
  });

  it('без изменений — тот же объект', () => {
    const sel = new Set([1, 2]);
    expect(pruneSelection(sel, [1, 2, 3])).toBe(sel);
  });
});

describe('rangeBetween', () => {
  const ids = [10, 20, 30, 40, 50];

  it('от якоря до цели в обе стороны', () => {
    expect(rangeBetween(ids, 20, 40)).toEqual([20, 30, 40]);
    expect(rangeBetween(ids, 40, 20)).toEqual([20, 30, 40]);
  });

  it('без якоря или с исчезнувшим якорем — только цель', () => {
    expect(rangeBetween(ids, null, 30)).toEqual([30]);
    expect(rangeBetween(ids, 99, 30)).toEqual([30]);
  });

  it('невидимая цель — пусто', () => {
    expect(rangeBetween(ids, 10, 99)).toEqual([]);
  });
});

describe('stepIndex', () => {
  it('стрелки с упором в края', () => {
    expect(stepIndex(5, 2, 'ArrowRight')).toBe(3);
    expect(stepIndex(5, 4, 'ArrowRight')).toBe(4);
    expect(stepIndex(5, 0, 'ArrowLeft')).toBe(0);
  });

  it('без выделения: → с начала, ← с конца', () => {
    expect(stepIndex(5, -1, 'ArrowRight')).toBe(0);
    expect(stepIndex(5, -1, 'ArrowLeft')).toBe(4);
  });

  it('Home/End и пустой вид', () => {
    expect(stepIndex(5, 2, 'Home')).toBe(0);
    expect(stepIndex(5, 2, 'End')).toBe(4);
    expect(stepIndex(0, -1, 'End')).toBe(-1);
  });

  it('сетка: ↑/↓ на ряд, у краёв на месте', () => {
    // 10 карточек по 4 в ряд: 0-3, 4-7, 8-9
    expect(stepIndex(10, 1, 'ArrowDown', 4)).toBe(5);
    expect(stepIndex(10, 5, 'ArrowUp', 4)).toBe(1);
    expect(stepIndex(10, 1, 'ArrowUp', 4)).toBe(1);
    expect(stepIndex(10, 9, 'ArrowDown', 4)).toBe(9);
  });

  it('сетка: ↓ из ряда над неполным - на последнюю', () => {
    expect(stepIndex(10, 7, 'ArrowDown', 4)).toBe(9);
    expect(stepIndex(10, 5, 'ArrowDown', 4)).toBe(9);
    expect(stepIndex(10, 4, 'ArrowDown', 4)).toBe(8);
  });

  it('сетка без выделения: ↓ с начала, ↑ с конца', () => {
    expect(stepIndex(10, -1, 'ArrowDown', 4)).toBe(0);
    expect(stepIndex(10, -1, 'ArrowUp', 4)).toBe(9);
  });
});
