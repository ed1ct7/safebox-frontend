import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { createRef, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { makeEntry } from '../test/factories';
import { makeWrapper } from '../test/tags';
import { Gallery } from './Gallery';
import type { DisplayItem, GalleryHandle } from './Gallery';
import type { EntryCardHandlers } from './EntryCard';

// Виртуальная сетка (К2). В jsdom нет раскладки: ширина сетки 900 (5 колонок),
// высота вида 800, карточка 200 - шаг строки 212.

const handlers: EntryCardHandlers = {
  onClick: vi.fn(),
  onToggleSelect: vi.fn(),
  onContextMenu: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameCommit: vi.fn(),
  onRenameCancel: vi.fn(),
  onHover: vi.fn(),
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  canDropOn: () => false,
  onDropOn: vi.fn(),
};

const items = (n: number): DisplayItem[] =>
  Array.from({ length: n }, (_, i) => ({ entry: makeEntry({ id: i + 1, kind: 'photo', name: `f${i + 1}.jpg` }) }));

let scroller: HTMLElement | null = null;
let viewH = 800;
let cardH = 200;
let resized: (() => void) | null = null; // колбэк ResizeObserver: «окно поменяло размер»

beforeEach(() => {
  viewH = 800;
  cardH = 200;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resized = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.gallery !== undefined ? 900 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this === scroller ? viewH : 0;
  });
  // сетка уезжает вверх вместе с прокруткой, вид стоит на месте (как в браузере)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.parentElement === scroller && scroller !== null ? -scroller.scrollTop : 0;
    const height = this.dataset.entryId !== undefined ? cardH : 0;
    return { top, left: 0, width: 900, height, right: 900, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scroller = null;
  resized = null;
});

function renderGallery(list: DisplayItem[], total = list.length, renamingId: number | null = null) {
  const handle = createRef<GalleryHandle | null>() as MutableRefObject<GalleryHandle | null>;
  function Host() {
    const ref = useRef<HTMLElement>(null);
    return (
      <main
        ref={(el) => {
          (ref as MutableRefObject<HTMLElement | null>).current = el;
          scroller = el;
        }}
      >
        <Gallery
          items={list}
          total={total}
          loading={false}
          isSearch={false}
          selection={new Set()}
          renamingId={renamingId}
          handlers={handlers}
          scrollRef={ref}
          handleRef={handle}
        />
      </main>
    );
  }
  const view = render(<Host />, { wrapper: makeWrapper().Wrapper });
  const ids = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-entry-id]')).map((el) => Number(el.dataset.entryId));
  const rerender = (next: DisplayItem[], nextRenaming: number | null = renamingId) => {
    list = next;
    renamingId = nextRenaming;
    view.rerender(<Host />);
  };
  return { ...view, handle, ids, rerender };
}

describe('Gallery: виртуальная сетка', () => {
  it('из 60 000 карточек в DOM только видимые строки с запасом', () => {
    const { ids, container } = renderGallery(items(60_000));
    // строки 0..6: 4 видимых (800/212) + 3 запаса снизу = 7 строк по 5
    expect(ids()).toHaveLength(35);
    expect(ids()[0]).toBe(1);
    // высота - на все 12 000 строк
    const root = container.querySelector<HTMLElement>('main > [data-gallery]');
    expect(root?.style.height).toBe(`${12_000 * 212 - 12}px`);
  });

  it('прокрутка рисует строки, до которых докрутили', () => {
    const { ids } = renderGallery(items(60_000));
    act(() => {
      scroller!.scrollTop = 1000 * 212;
      fireEvent.scroll(scroller!);
    });
    expect(ids()[0]).toBe(997 * 5 + 1); // запас 3 строки сверху
    expect(ids()).toContain(1000 * 5 + 1);
  });

  it('не загруженное ещё - заглушки на своём месте', () => {
    const { container, ids } = renderGallery(items(200), 60_000);
    act(() => {
      scroller!.scrollTop = 500 * 212;
      fireEvent.scroll(scroller!);
    });
    expect(ids()).toHaveLength(0);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('ручки: колонки, рамка по геометрии (и за экраном), прокрутка к карточке', () => {
    const { handle } = renderGallery(items(60_000));
    expect(handle.current?.columns()).toBe(5);
    // getBoundingClientRect в jsdom - нули: координаты рамки = координаты сетки
    expect(handle.current?.hitTest({ left: 0, top: 0, width: 400, height: 10 })).toEqual([1, 2, 3]);
    expect(handle.current?.hitTest({ left: 0, top: 5000 * 212, width: 10, height: 10 })).toEqual([25_001]);
    act(() => handle.current?.reveal(50_000));
    expect(scroller!.scrollTop).toBe(10_000 * 212 + 200 - 800);
  });

  it('прокрутка к карточке сразу рисует её строку, без события scroll', () => {
    const { handle, ids } = renderGallery(items(60_000));
    act(() => handle.current?.reveal(50_000));
    expect(ids()).toContain(50_001);
    act(() => handle.current?.reveal(0)); // Home
    expect(scroller!.scrollTop).toBe(0);
    expect(ids()[0]).toBe(1);
  });

  it('окно стало выше - дорисовываются строки снизу без прокрутки', () => {
    const { ids } = renderGallery(items(60_000));
    expect(ids()).toHaveLength(35);
    viewH = 2000;
    act(() => resized?.());
    expect(ids()).toContain(60); // строка 11 (2000/212 ≈ 9,4 видимых + запас)
  });

  it('карточки стали выше (поздняя страница с тегами) - вид остаётся на той же карточке', () => {
    const list = items(60_000);
    const { ids, rerender } = renderGallery(list);
    act(() => {
      scroller!.scrollTop = 1000 * 212 + 50;
      fireEvent.scroll(scroller!);
    });
    cardH = 222; // строка тегов: карточка +22 px
    const tagged = list.map((d, i) => (i === 59_999 ? { entry: { ...d.entry, tags: [{ tagId: 1, inherit: false }] } } : d));
    act(() => rerender(tagged));
    expect(scroller!.scrollTop).toBeCloseTo(1000 * 234 + (50 / 212) * 234);
    expect(ids()).toContain(1000 * 5 + 1);
  });

  it('переименуемая карточка остаётся в DOM, когда её строку прокрутили далеко', () => {
    const { ids } = renderGallery(items(60_000), 60_000, 3);
    act(() => {
      scroller!.scrollTop = 1000 * 212;
      fireEvent.scroll(scroller!);
    });
    expect(ids()).toContain(3);
    expect(ids()).toContain(1000 * 5 + 1);
  });
});
