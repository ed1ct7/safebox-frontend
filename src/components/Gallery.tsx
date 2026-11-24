import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { Entry, SearchHit } from '../api/types';
import { useEvent } from '../hooks/useEvent';
import { firstLine } from '../lib/format';
import { GAP_PX, gridGeometry, gridHeight, hitIndices, rowRange, scrollToShow } from '../lib/gridLayout';
import { boxesIntersect } from '../lib/rubberBand';
import type { Box } from '../lib/rubberBand';
import type { Selection } from '../lib/selection';
import { EntryCard } from './EntryCard';
import type { CardLines, EntryCardHandlers } from './EntryCard';

export interface DisplayItem {
  entry: Entry;
  /** показывается вместо размера/домена: путь папки в результатах поиска */
  caption?: string;
  /** первая строка описания в результатах поиска/фильтра */
  snippet?: string;
  /** где нашлось: в описании помечаем на карточке (UF-8) */
  matchedIn?: SearchHit['matchedIn'];
  /** только что добавлена (UF-20): карточка подсвечена на пару секунд */
  fresh?: boolean;
}

/** Что окно спрашивает у сетки: всё по номеру карточки, нарисована она или нет. */
export interface GalleryHandle {
  /** колонок в строке (для ↑/↓) */
  columns: () => number;
  /** прокрутить так, чтобы карточка index была видна */
  reveal: (index: number) => void;
  /** id карточек под рамкой; band - в клиентских координатах */
  hitTest: (band: Box) => number[];
}

/** Строк запаса над и под видимым: короткая прокрутка не показывает пустоты. */
const OVERSCAN_ROWS = 3;
/** Карточек до первого замера размеров. */
const FIRST_FRAME = 60;

/** Строка описания на карточке: сниппет в результатах или описание ссылки. */
function hasDetail(d: DisplayItem): boolean {
  if (d.snippet !== undefined && d.snippet !== '') return true;
  return d.entry.kind === 'link' && firstLine(d.entry.description) !== '';
}

function hasTags(d: DisplayItem): boolean {
  return d.entry.tags.length > 0 || (d.entry.inheritedTags?.length ?? 0) > 0;
}

/** Высота карточки до первого замера: картинка 4:3 и строки подписи. */
function estimateCardH(cardW: number, lines: CardLines): number {
  return Math.max(0, cardW - 16) * 0.75 + 8 + 48 + (lines.detail ? 18 : 0) + (lines.tags ? 22 : 0);
}

/** Колонки без раскладки по ширине (jsdom, первый кадр): карточки на одной высоте с первой. */
function domColumns(root: HTMLElement | null): number {
  const cards = root?.querySelectorAll<HTMLElement>('[data-entry-id]');
  const first = cards?.[0];
  if (cards === undefined || first === undefined) return 1;
  let n = 0;
  for (const c of cards) {
    if (c.offsetTop !== first.offsetTop) break;
    n += 1;
  }
  return Math.max(1, n);
}

/**
 * Сетка карточек (UF-3) с пустым состоянием «Здесь пока пусто» (UF-1).
 * К2: виртуальная - рисуются только видимые строки (плюс запас), высота сетки -
 * на все total записей, ещё не загруженные показаны заглушками. Все карточки
 * одной высоты (строки описания и тегов резервируются для всей выдачи сразу),
 * поэтому рамка выделения, стрелки и прокрутка к карточке считаются по номеру.
 * Без размеров (тесты в jsdom, нет ResizeObserver) - обычная сетка из всех карточек.
 */
export function Gallery({
  items,
  total = items.length,
  loading,
  isSearch,
  selection,
  renamingId,
  handlers,
  scrollRef,
  handleRef,
}: {
  items: DisplayItem[];
  /** записей всего (загружено items.length) */
  total?: number;
  loading: boolean;
  isSearch: boolean;
  selection: Selection;
  renamingId: number | null;
  handlers: EntryCardHandlers;
  /** прокручиваемый вид, внутри которого лежит сетка */
  scrollRef?: RefObject<HTMLElement>;
  handleRef?: MutableRefObject<GalleryHandle | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [cardH, setCardH] = useState(0); // замер; 0 - ещё не мерили
  const [range, setRange] = useState<[number, number]>([0, 0]);

  const lines = useMemo<CardLines>(
    () => ({ detail: items.some(hasDetail), tags: items.some(hasTags) }),
    [items],
  );
  const count = Math.max(total, items.length);
  const renaming = useMemo(
    () => (renamingId === null ? -1 : items.findIndex((d) => d.entry.id === renamingId)),
    [items, renamingId],
  );
  const renamingItem = renaming >= 0 ? items[renaming] : undefined;
  // jsdom без ResizeObserver - обычная сетка; в браузере - виртуальная, как только известны размеры
  const canMeasure = scrollRef !== undefined && typeof ResizeObserver !== 'undefined';
  const virtual = canMeasure && width > 0 && viewH > 0;
  const g = useMemo(() => {
    const probe = gridGeometry(width, 0);
    return gridGeometry(width, cardH > 0 ? cardH : estimateCardH(probe.cardW, lines));
  }, [width, cardH, lines]);

  // ширина сетки и высота вида: сразу до отрисовки (иначе первый кадр - вся папка) и по изменениям
  const shown = !loading && count > 0; // сетка в DOM
  // (ref прокручиваемого родителя ставится после layout-эффектов детей: при первом
  // монтировании его ещё нет - тогда меряем в обычном эффекте, там он уже есть)
  const measure = useEvent(() => {
    const root = rootRef.current;
    const sc = scrollRef?.current;
    if (root === null || sc == null) return false;
    setWidth(root.clientWidth);
    setViewH(sc.clientHeight);
    return true;
  });
  useLayoutEffect(() => {
    if (canMeasure && shown) measure();
  }, [canMeasure, shown, measure]);
  useEffect(() => {
    const root = rootRef.current;
    const sc = scrollRef?.current;
    if (!canMeasure || !shown || root === null || sc == null) return;
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [scrollRef, canMeasure, shown, measure]);

  /** Где сетка начинается внутри прокручиваемого вида. */
  const topIn = (sc: HTMLElement, root: HTMLElement) =>
    root.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;

  // первая видимая карточка: при смене геометрии (ширина окна, высота карточки, когда
  // поздняя страница включила строку тегов) вид остаётся на ней, а не уезжает на тысячи px
  const anchor = useRef<{ index: number; frac: number } | null>(null);

  const sync = useEvent(() => {
    const root = rootRef.current;
    const sc = scrollRef?.current;
    if (!virtual || root === null || sc == null) return;
    const top = topIn(sc, root);
    const next = rowRange(sc.scrollTop, sc.clientHeight, top, g, count, OVERSCAN_ROWS);
    setRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    const y0 = sc.scrollTop - top;
    const row = Math.floor(y0 / g.rowH);
    anchor.current = y0 > 0 ? { index: row * g.cols, frac: (y0 - row * g.rowH) / g.rowH } : null;
  });

  const prevG = useRef(g);
  useLayoutEffect(() => {
    const was = prevG.current;
    prevG.current = g;
    const a = anchor.current;
    const sc = scrollRef?.current;
    const root = rootRef.current;
    if (!virtual || a === null || sc == null || root === null) return;
    if (was.cols === g.cols && was.rowH === g.rowH) return;
    sc.scrollTop = topIn(sc, root) + Math.floor(a.index / g.cols) * g.rowH + a.frac * g.rowH;
  }, [g, virtual, scrollRef]);

  useEffect(() => {
    const sc = scrollRef?.current;
    if (sc == null) return;
    sc.addEventListener('scroll', sync, { passive: true });
    return () => sc.removeEventListener('scroll', sync);
  }, [scrollRef, sync]);

  useLayoutEffect(() => sync(), [sync, virtual, g, count, viewH]);

  // высота карточки - по нарисованной (не той, что сейчас переименовывается)
  useLayoutEffect(() => {
    if (!virtual) return;
    // дробная высота (картинка 4:3 от дробной ширины): по округлённой строки поползли бы
    const card = innerRef.current?.querySelector<HTMLElement>('[data-entry-id]:not([data-renaming])');
    const h = card?.getBoundingClientRect().height ?? 0;
    if (h > 0 && Math.abs(h - cardH) > 0.5) setCardH(h);
  });

  // ручки для окна: стрелки, прокрутка к карточке, рамка
  useEffect(() => {
    if (handleRef === undefined) return;
    handleRef.current = {
      columns: () => (virtual ? g.cols : domColumns(innerRef.current)),
      reveal: (index) => {
        const sc = scrollRef?.current;
        const root = rootRef.current;
        if (virtual && sc != null && root !== null) {
          const y = scrollToShow(index, g, topIn(sc, root), sc.scrollTop, sc.clientHeight);
          // строки - сразу, не дожидаясь события scroll (оно может прийти позже кадра или не прийти)
          if (y !== null) {
            sc.scrollTop = y;
            sync();
          }
          return;
        }
        const id = items[index]?.entry.id;
        if (id === undefined) return;
        innerRef.current?.querySelector(`[data-entry-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
      },
      hitTest: (band) => {
        const root = rootRef.current;
        if (root === null) return [];
        if (virtual) {
          const r = root.getBoundingClientRect();
          const box = { left: band.left - r.left, top: band.top - r.top, width: band.width, height: band.height };
          return hitIndices(box, g, items.length).map((i) => items[i]!.entry.id);
        }
        return Array.from(root.querySelectorAll<HTMLElement>('[data-entry-id]'))
          .filter((el) => boxesIntersect(el.getBoundingClientRect(), band))
          .map((el) => Number(el.dataset.entryId));
      },
    };
  });
  useEffect(() => () => {
    if (handleRef !== undefined) handleRef.current = null;
  }, [handleRef]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" aria-busy="true">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <span className="text-4xl opacity-40">{isSearch ? '🔍' : '🗃️'}</span>
        <p className="text-sm text-zinc-400">{isSearch ? 'Ничего не найдено' : 'Здесь пока пусто'}</p>
        {!isSearch && (
          <p className="text-xs text-zinc-600">
            Перетащите сюда файлы или папки · «Импорт» сверху · Ctrl+V — вставить ссылку или картинку
          </p>
        )}
      </div>
    );
  }

  const card = (item: DisplayItem) => (
    <EntryCard
      key={item.entry.id}
      entry={item.entry}
      caption={item.caption}
      snippet={item.snippet}
      matchedIn={item.matchedIn}
      selected={selection.has(item.entry.id)}
      renaming={renamingId === item.entry.id}
      fresh={item.fresh}
      lines={lines}
      handlers={handlers}
    />
  );

  if (!virtual) {
    // до замера в браузере - только начало (размеры придут до отрисовки), в jsdom - всё
    const list = canMeasure ? items.slice(0, FIRST_FRAME) : items;
    return (
      <div ref={rootRef} data-gallery="">
        <div
          ref={innerRef}
          data-gallery=""
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}
        >
          {list.map(card)}
        </div>
      </div>
    );
  }

  const [first, end] = range;
  const from = first * g.cols;
  const to = Math.min(end * g.cols, count);
  const rowStyle = {
    gap: GAP_PX,
    gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`,
    gridAutoRows: g.cardH, // шаг строк ровно как в расчётах, без набегающих долей пикселя
  };
  const cells = [];
  for (let i = from; i < to; i++) {
    const item = items[i];
    cells.push(
      i === renaming ? (
        <div key={`renaming-${i}`} aria-hidden="true" /> // сама карточка - в своём слое ниже
      ) : item !== undefined ? (
        card(item)
      ) : (
        // ещё не загружено: место под карточку, чтобы прокрутка и высота были честными
        <div
          key={`pending-${i}`}
          aria-hidden="true"
          data-gallery=""
          className="animate-pulse rounded-xl border border-zinc-800/60 bg-zinc-900/30"
          style={{ height: g.cardH }}
        />
      ),
    );
  }

  return (
    <div ref={rootRef} data-gallery="" className="relative" style={{ height: gridHeight(count, g) }}>
      <div
        ref={innerRef}
        data-gallery=""
        className="absolute inset-x-0 grid items-start"
        style={{ top: first * g.rowH, ...rowStyle }}
      >
        {cells}
      </div>
      {renamingItem !== undefined && (
        // переименуемая карточка не исчезает при прокрутке: набранное имя и фокус не теряются
        <div
          data-gallery=""
          className="pointer-events-none absolute inset-x-0 grid items-start"
          style={{ top: Math.floor(renaming / g.cols) * g.rowH, ...rowStyle }}
        >
          <div className="pointer-events-auto" style={{ gridColumnStart: (renaming % g.cols) + 1 }}>
            {card(renamingItem)}
          </div>
        </div>
      )}
    </div>
  );
}
