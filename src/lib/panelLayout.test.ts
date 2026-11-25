import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SIZES,
  MAX_WIDTH,
  MIN_SPLIT,
  PRESETS,
  dockPanel,
  hitTest,
  parseLayout,
  parseSizes,
  presetOf,
} from './panelLayout';

const stack = PRESETS.stack.layout;

describe('dockPanel', () => {
  it('на нижний край другой панели - стопкой под ней', () => {
    const l = dockPanel(PRESETS.apart.layout, 'tags', { kind: 'panel', edge: 'bottom' });
    expect(l).toEqual(stack);
  });

  it('на верхний край - стопкой над ней', () => {
    const l = dockPanel(stack, 'tags', { kind: 'panel', edge: 'top' });
    expect(l.left).toEqual({ mode: 'stack', items: ['tags', 'folders'] });
    expect(l.right.items).toEqual([]);
  });

  it('на правый край - колонкой справа от неё', () => {
    expect(dockPanel(stack, 'tags', { kind: 'panel', edge: 'right' })).toEqual(PRESETS.cols.layout);
  });

  it('другая панель справа - пара собирается справа', () => {
    const l = dockPanel(PRESETS.apart.layout, 'folders', { kind: 'panel', edge: 'left' });
    expect(l.left.items).toEqual([]);
    expect(l.right).toEqual({ mode: 'cols', items: ['folders', 'tags'] });
  });

  it('к краю галереи - на ту сторону; одна панель в доке всегда stack', () => {
    expect(dockPanel(stack, 'tags', { kind: 'edge', side: 'right' })).toEqual(PRESETS.apart.layout);
  });

  it('к краю своей стороны - крайней колонкой', () => {
    const l = dockPanel(stack, 'tags', { kind: 'edge', side: 'left' });
    expect(l.left).toEqual({ mode: 'cols', items: ['tags', 'folders'] });
    const r = dockPanel(PRESETS.apart.layout, 'folders', { kind: 'edge', side: 'right' });
    expect(r.right).toEqual({ mode: 'cols', items: ['tags', 'folders'] });
  });

  it('не меняет прежнюю раскладку', () => {
    const before = JSON.stringify(stack);
    dockPanel(stack, 'folders', { kind: 'edge', side: 'right' });
    expect(JSON.stringify(stack)).toBe(before);
  });
});

describe('presetOf', () => {
  it('узнаёт готовые варианты, режим одинокой панели не важен', () => {
    expect(presetOf(stack)).toBe('stack');
    expect(presetOf(PRESETS.cols.layout)).toBe('cols');
    expect(
      presetOf({ left: { mode: 'cols', items: ['folders'] }, right: { mode: 'cols', items: ['tags'] } }),
    ).toBe('apart');
    expect(presetOf({ left: { mode: 'stack', items: ['tags', 'folders'] }, right: { mode: 'stack', items: [] } })).toBe(
      undefined,
    );
  });
});

describe('parseLayout', () => {
  it('битое и неполное - по умолчанию', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('x')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ left: { mode: 'stack', items: ['folders'] }, right: { mode: 'stack', items: [] } })).toEqual(
      DEFAULT_LAYOUT,
    );
    expect(
      parseLayout({ left: { mode: 'stack', items: ['folders', 'folders'] }, right: { mode: 'stack', items: [] } }),
    ).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ left: { mode: 'grid', items: ['folders', 'tags'] }, right: { mode: 'stack', items: [] } })).toEqual(
      DEFAULT_LAYOUT,
    );
  });

  it('корректное сохраняется', () => {
    expect(parseLayout(JSON.parse(JSON.stringify(PRESETS.apart.layout)))).toEqual(PRESETS.apart.layout);
  });
});

describe('parseSizes', () => {
  it('ограничивает и подставляет недостающее', () => {
    const s = parseSizes({ dockLeft: 9999, splitLeft: 0, tags: 'x' });
    expect(s.dockLeft).toBe(MAX_WIDTH);
    expect(s.splitLeft).toBe(MIN_SPLIT);
    expect(s.tags).toBe(DEFAULT_SIZES.tags);
  });
});

describe('hitTest', () => {
  const other = { left: 0, top: 100, width: 200, height: 400 };
  const content = { left: 260, top: 50, width: 800, height: 600 };

  it('ближайший край другой панели', () => {
    expect(hitTest(100, 110, other, content)?.target).toEqual({ kind: 'panel', edge: 'top' });
    expect(hitTest(100, 490, other, content)?.target).toEqual({ kind: 'panel', edge: 'bottom' });
    expect(hitTest(190, 300, other, content)?.target).toEqual({ kind: 'panel', edge: 'right' });
    expect(hitTest(100, 490, other, content)?.preview).toEqual({ left: 0, top: 300, width: 200, height: 200 });
  });

  it('кромки галереи', () => {
    expect(hitTest(270, 300, other, content)?.target).toEqual({ kind: 'edge', side: 'left' });
    expect(hitTest(1050, 300, other, content)?.target).toEqual({ kind: 'edge', side: 'right' });
    expect(hitTest(600, 300, other, content)).toBeNull();
    expect(hitTest(270, 10, other, content)).toBeNull();
  });
});
