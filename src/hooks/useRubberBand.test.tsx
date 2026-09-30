import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useRubberBand } from './useRubberBand';
import type { RubberCard } from './useRubberBand';

// Элементы с настоящими прямоугольниками: в jsdom их нет, подставляем свои.
function card(id: number, left: number, top: number): RubberCard {
  return {
    id,
    el: { getBoundingClientRect: () => ({ left, top, width: 50, height: 50, right: left + 50, bottom: top + 50 }) } as unknown as HTMLElement,
  };
}

const CARDS = [card(1, 0, 0), card(2, 100, 0), card(3, 0, 100), card(4, 100, 100)];

function Harness({
  cards = CARDS,
  base = new Set<number>(),
  isBackground = () => true,
  viewport = null,
  onSelect,
}: {
  cards?: RubberCard[];
  base?: ReadonlySet<number>;
  isBackground?: (down: unknown) => boolean;
  viewport?: object | null;
  onSelect: (ids: number[]) => void;
}) {
  const rubber = useRubberBand({
    isBackground: isBackground as never,
    getCards: () => cards,
    getBase: () => base,
    onSelect,
    getViewport: () => viewport as HTMLElement | null,
  });
  return (
    <main
      data-testid="main"
      onPointerDown={rubber.onPointerDown}
      aria-busy={rubber.box !== null}
    />
  );
}

// jsdom не знает PointerEvent: fireEvent.pointerDown теряет button/clientX,
// поэтому шлём MouseEvent с pointer-типом - React слушает по имени события
function firePointer(target: Element | Window, type: string, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }, extra: MouseEventInit = {}) {
  firePointer(screenMain(), 'pointerdown', { button: 0, clientX: from.x, clientY: from.y, ...extra });
  firePointer(window, 'pointermove', { clientX: to.x, clientY: to.y });
  firePointer(window, 'pointerup');
}

const actAsync = (fn: () => void) => act(async () => { fn(); });

function screenMain() {
  return document.querySelector('[data-testid="main"]') as HTMLElement;
}

describe('useRubberBand', () => {
  it('протяжка через верхний ряд выделяет его карточки', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    drag({ x: -10, y: -10 }, { x: 180, y: 40 });
    const calls = onSelect.mock.calls.map((c) => [...c[0]].sort());
    expect(calls.at(-1)).toEqual([1, 2]);
    // последний вызов - фиксация, набор тот же, что и по ходу
    expect(new Set(calls)).toEqual(new Set([[1, 2]]));
  });

  it('движение меньше порога - это клик: ничего не выделяется', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    drag({ x: 10, y: 10 }, { x: 12, y: 12 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Ctrl в начале - рамка добавляет к уже выделенному', () => {
    const onSelect = vi.fn();
    render(<Harness base={new Set([3])} onSelect={onSelect} />);
    drag({ x: -10, y: -10 }, { x: 60, y: 60 }, { ctrlKey: true });
    const last = onSelect.mock.calls.at(-1)?.[0] ?? [];
    expect([...last].sort()).toEqual([1, 3]);
  });

  it('протяжка с карточки (не с фона) не стартует рамку', () => {
    const onSelect = vi.fn();
    render(<Harness isBackground={() => false} onSelect={onSelect} />);
    drag({ x: -10, y: -10 }, { x: 180, y: 40 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('не левая кнопка - игнор', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    firePointer(screenMain(), 'pointerdown', { button: 2, clientX: 0, clientY: 0 });
    firePointer(window, 'pointermove', { clientX: 100, clientY: 100 });
    firePointer(window, 'pointerup');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('курсор у верхней кромки: вид прокручивается вверх, рамка пересчитывается', async () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      // вид 600px высотой, прокручен на 400; карточка 3 «уехала» вверх за кромку
      const viewport = {
        scrollTop: 400, scrollHeight: 2000, clientHeight: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
      };
      render(<Harness viewport={viewport} onSelect={onSelect} />);
      // тянем рамку к верхней кромке и держим курсор там (движений больше нет)
      firePointer(screenMain(), 'pointerdown', { button: 0, clientX: 400, clientY: 300 });
      firePointer(window, 'pointermove', { clientX: 400, clientY: 15 });
      expect(viewport.scrollTop).toBe(400); // прокрутка идёт по таймеру, не мгновенно
      await actAsync(() => { vi.advanceTimersByTime(200); });
      expect(viewport.scrollTop).toBeLessThan(400); // покрутилось вверх
      expect(onSelect.mock.calls.length).toBeGreaterThan(1); // и рамка пересчитывалась
      firePointer(window, 'pointerup');
      await actAsync(() => { vi.advanceTimersByTime(100); });
      const frozen = viewport.scrollTop;
      await actAsync(() => { vi.advanceTimersByTime(200); });
      expect(viewport.scrollTop).toBe(frozen); // после отпускания прокрутки нет
    } finally {
      vi.useRealTimers();
    }
  });

  it('пока протяжка идёт, рамка видна; после отпускания - нет', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    firePointer(screenMain(), 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    firePointer(window, 'pointermove', { clientX: 100, clientY: 100 });
    await waitFor(() => expect(screenMain()).toHaveAttribute('aria-busy', 'true'));
    firePointer(window, 'pointerup');
    await waitFor(() => expect(screenMain()).toHaveAttribute('aria-busy', 'false'));
  });
});
