import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { boxFromPoints, boxesIntersect } from '../lib/rubberBand';
import type { Box } from '../lib/rubberBand';
import { useWindowEvent } from './useEvent';

/** Карточка для рамки: id записи и её элемент (для getBoundingClientRect). */
export interface RubberCard {
  id: number;
  el: HTMLElement;
}

const THRESHOLD_PX = 5; // меньше - это клик, а не протяжка
const EDGE_PX = 36; // зона у кромки, где включается автоскролл
const MAX_SPEED_PX = 28; // прокрутка за кадр в глубине зоны
const TICK_MS = 16; // ~кадр; курсор может стоять у края, а прокрутка идёт

/**
 * Рамка выделения «как в проводнике» (UF-9): левая кнопка на пустом месте
 * галереи + протяжка - все карточки под рамкой выделяются, живьём по ходу
 * движения. Ctrl/Cmd в начале протяжки - добавить к уже выделенному, без -
 * заменить. Якорь хранится в координатах содержимого, поэтому при прокрутке
 * рамка следует за точкой старта, а не прилипает к окну. Курсор у верхней или
 * нижней кромки скроллимого вида (getViewport) - вид прокручивается, как в
 * проводнике, и выделение продолжает захватывать уходящие карточки.
 * Возвращает onPointerDown для контейнера, прямоугольник рамки (клиентские
 * координаты, рисовать fixed) и justCommitted: клик по фону сразу после рамки
 * не должен снимать свежее выделение.
 */
export function useRubberBand({
  isBackground,
  getCards,
  getBase,
  onSelect,
  getViewport,
}: {
  /** pointerdown пришёл на фон галереи, а не на карточку */
  isBackground: (e: ReactPointerEvent) => boolean;
  /** видимые карточки с элементами; зовётся на каждом пересчёте рамки */
  getCards: () => RubberCard[];
  /** выделение на момент старта протяжки (база для Ctrl-варианта) */
  getBase: () => ReadonlySet<number>;
  /** применить выделение (и по ходу протяжки, и по её концу) */
  onSelect: (ids: number[]) => void;
  /** скроллимый вид галереи (для автоскролла у кромок); нет - без автоскролла */
  getViewport?: () => HTMLElement | null;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const start = useRef<{ x: number; yContent: number; additive: boolean; active: boolean; base: ReadonlySet<number> } | null>(
    null,
  );
  const last = useRef({ x: 0, y: 0 });
  const justCommitted = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<() => void>(() => undefined);

  const stopTick = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(stopTick, []); // компонент ушёл - интервал не должен жить

  /** Рамка от якоря (в координатах содержимого) до текущей позиции курсора. */
  const update = (cx: number, cy: number) => {
    const s = start.current;
    if (s === null) return;
    const scrollTop = getViewport?.()?.scrollTop ?? 0;
    const band = boxFromPoints(s.x, s.yContent - scrollTop, cx, cy);
    setBox(band);
    const hits = getCards()
      .filter((c) => boxesIntersect(c.el.getBoundingClientRect(), band))
      .map((c) => c.id);
    onSelect(s.additive ? [...new Set([...s.base, ...hits])] : hits);
  };

  /** Раз в кадр: курсор в зоне у кромки - прокрутить и пересчитать рамку. */
  const tick = () => {
    const vp = getViewport?.();
    if (vp == null) return;
    const r = vp.getBoundingClientRect();
    let dy = 0;
    if (last.current.y < r.top + EDGE_PX) dy = -Math.min(MAX_SPEED_PX, r.top + EDGE_PX - last.current.y);
    else if (last.current.y > r.bottom - EDGE_PX) dy = Math.min(MAX_SPEED_PX, last.current.y - (r.bottom - EDGE_PX));
    if (dy === 0) return;
    const max = Math.max(0, (vp.scrollHeight ?? 0) - (vp.clientHeight ?? 0));
    const before = vp.scrollTop;
    vp.scrollTop = Math.min(Math.max(0, before + dy), max);
    if (vp.scrollTop === before) return; // упёрлись в край - позиция не менялась
    update(last.current.x, last.current.y);
  };
  tickRef.current = tick;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      justCommitted.current = false;
      if (e.button !== 0 || !isBackground(e)) return;
      const additive = e.ctrlKey || e.metaKey;
      const vp = getViewport?.();
      start.current = {
        x: e.clientX,
        yContent: e.clientY + (vp?.scrollTop ?? 0),
        additive,
        active: false,
        base: additive ? getBase() : new Set(),
      };
      last.current = { x: e.clientX, y: e.clientY };
    },
    [isBackground, getBase, getViewport],
  );

  useWindowEvent('pointermove', (e) => {
    const s = start.current;
    if (s === null) return;
    last.current = { x: e.clientX, y: e.clientY };
    if (!s.active) {
      const vp = getViewport?.();
      const moved =
        Math.abs(e.clientX - s.x) + Math.abs(e.clientY - (s.yContent - (vp?.scrollTop ?? 0)));
      if (moved < THRESHOLD_PX) return;
      s.active = true;
      if (timer.current === null) timer.current = setInterval(() => tickRef.current(), TICK_MS);
    }
    update(e.clientX, e.clientY);
  });

  useWindowEvent('pointerup', () => {
    const s = start.current;
    if (s !== null && s.active) justCommitted.current = true; // клик-в-фоне после рамки - не сброс
    start.current = null;
    stopTick();
    setBox(null);
  });

  return { box, onPointerDown, justCommitted };
}
