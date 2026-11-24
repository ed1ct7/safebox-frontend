import { describe, expect, it } from 'vitest';
import { columnsFor, gridGeometry, gridHeight, hitIndices, rowRange, scrollToShow } from './gridLayout';

// ширина 900: (900+12)/(170+12) = 5 колонок по (900-48)/5 = 170,4
const g = gridGeometry(900, 200);

describe('gridLayout', () => {
  it('колонки как у auto-fill: хотя бы одна', () => {
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(170)).toBe(1);
    expect(columnsFor(352)).toBe(2);
    expect(g.cols).toBe(5);
    expect(g.cardW).toBeCloseTo(170.4);
    expect(g.rowH).toBe(212);
  });

  it('высота сетки: строки без зазора под последней', () => {
    expect(gridHeight(0, g)).toBe(0);
    expect(gridHeight(5, g)).toBe(200);
    expect(gridHeight(6, g)).toBe(412);
  });

  it('видимые строки с запасом, не за пределами', () => {
    // 60000 карточек = 12000 строк; вид 800 px, прокручено на 100 строк
    expect(rowRange(100 * 212, 800, 0, g, 60000, 2)).toEqual([98, 106]);
    expect(rowRange(0, 800, 16, g, 60000, 2)).toEqual([0, 6]);
    expect(rowRange(1e9, 800, 0, g, 12, 2)).toEqual([3, 3]); // далеко за концом - пусто
    expect(rowRange(0, 800, 0, g, 0)).toEqual([0, 0]);
  });

  it('рамка: карточки под ней, зазоры и хвост последней строки не считаются', () => {
    // от середины 1-й карточки до середины 2-й во 2-й строке
    expect(hitIndices({ left: 80, top: 100, width: 200, height: 212 }, g, 100)).toEqual([0, 1, 5, 6]);
    // целиком в зазоре между строками
    expect(hitIndices({ left: 0, top: 202, width: 900, height: 6 }, g, 100)).toEqual([]);
    // в зазоре между колонками
    expect(hitIndices({ left: 172, top: 0, width: 8, height: 400 }, g, 100)).toEqual([]);
    // последняя строка неполная: 7 карточек, рамка по всей второй строке
    expect(hitIndices({ left: 0, top: 220, width: 900, height: 50 }, g, 7)).toEqual([5, 6]);
    // далеко внизу, в строках, которых нет на экране
    expect(hitIndices({ left: 0, top: 5000 * 212, width: 10, height: 10 }, g, 60000)).toEqual([25000]);
  });

  it('прокрутка к карточке: только если не видна, ближайшим краем', () => {
    expect(scrollToShow(0, g, 16, 0, 800)).toBeNull();
    expect(scrollToShow(50, g, 16, 0, 800)).toBe(16 + 10 * 212 + 200 - 800); // ниже - к нижнему краю
    expect(scrollToShow(5, g, 16, 1000, 800)).toBe(16 + 212); // выше - к верхнему
  });
});
