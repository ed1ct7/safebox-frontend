// Геометрия виртуальной сетки карточек (К2): чистые функции без React и DOM.
// Все карточки одной высоты (EntryCard держит строки фиксированными), поэтому
// положение любой карточки - арифметика от номера: рамка выделения, стрелки и
// прокрутка к карточке работают и для тех, что сейчас не нарисованы.

import type { Box } from './rubberBand';

/** Минимальная ширина карточки и зазор - как у прежней сетки auto-fill minmax(170px, 1fr), gap-3. */
export const CARD_MIN_PX = 170;
export const GAP_PX = 12;

export interface GridGeometry {
  cols: number;
  /** ширина карточки */
  cardW: number;
  /** высота карточки */
  cardH: number;
  /** шаг строки: карточка + зазор */
  rowH: number;
}

/** Сколько колонок помещается в ширину (как auto-fill: хотя бы одна). */
export function columnsFor(width: number, min = CARD_MIN_PX, gap = GAP_PX): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

export function gridGeometry(width: number, cardH: number, gap = GAP_PX): GridGeometry {
  const cols = columnsFor(width, CARD_MIN_PX, gap);
  const cardW = Math.max(0, (width - gap * (cols - 1)) / cols);
  return { cols, cardW, cardH, rowH: cardH + gap };
}

/** Высота всей сетки из count карточек (без зазора под последней строкой). */
export function gridHeight(count: number, g: GridGeometry): number {
  const rows = Math.ceil(count / g.cols);
  return rows === 0 ? 0 : rows * g.rowH - (g.rowH - g.cardH);
}

/**
 * Какие строки рисовать: [first, end) с запасом overscan строк сверху и снизу.
 * scrollTop и viewH - у прокручиваемого вида, top - где в нём начинается сетка.
 */
export function rowRange(
  scrollTop: number,
  viewH: number,
  top: number,
  g: GridGeometry,
  count: number,
  overscan = 2,
): [number, number] {
  const rows = Math.ceil(count / g.cols);
  if (rows === 0 || g.rowH <= 0) return [0, 0];
  const y0 = scrollTop - top;
  const first = Math.max(0, Math.floor(y0 / g.rowH) - overscan);
  const end = Math.min(rows, Math.ceil((y0 + viewH) / g.rowH) + overscan);
  return [Math.min(first, end), end];
}

/** Номера карточек под рамкой; box - в координатах сетки (0,0 - её левый верхний угол). */
export function hitIndices(box: Box, g: GridGeometry, count: number): number[] {
  if (count === 0 || g.rowH <= 0) return [];
  const x1 = box.left + box.width;
  const y1 = box.top + box.height;
  const colStep = g.cardW + (g.rowH - g.cardH);
  const rows = Math.ceil(count / g.cols);
  const rFirst = Math.max(0, Math.floor(box.top / g.rowH));
  const rLast = Math.min(rows - 1, Math.floor(y1 / g.rowH));
  const cFirst = Math.max(0, Math.floor(box.left / colStep));
  const cLast = Math.min(g.cols - 1, Math.floor(x1 / colStep));
  const out: number[] = [];
  for (let r = rFirst; r <= rLast; r++) {
    const top = r * g.rowH;
    if (top > y1 || top + g.cardH < box.top) continue; // рамка целиком в зазоре между строками
    for (let c = cFirst; c <= cLast; c++) {
      const left = c * colStep;
      if (left > x1 || left + g.cardW < box.left) continue;
      const i = r * g.cols + c;
      if (i < count) out.push(i);
    }
  }
  return out;
}

/**
 * Куда прокрутить, чтобы карточка index была видна целиком (как scrollIntoView
 * с block: 'nearest'); null - уже видна.
 */
export function scrollToShow(index: number, g: GridGeometry, top: number, scrollTop: number, viewH: number): number | null {
  const cardTop = top + Math.floor(index / g.cols) * g.rowH;
  const cardBottom = cardTop + g.cardH;
  if (cardTop < scrollTop) return cardTop;
  if (cardBottom > scrollTop + viewH) return Math.max(0, cardBottom - viewH);
  return null;
}
