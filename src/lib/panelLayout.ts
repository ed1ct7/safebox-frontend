// Раскладка боковых панелей «Папки» и «Теги»: обе видны всегда, их можно
// поставить друг под другом, рядом колонками или по разные стороны галереи.
// Здесь только модель - чистые функции; состояние и сохранение в usePanelLayout.

export type PanelId = 'folders' | 'tags';
export type DockSide = 'left' | 'right';
/** stack - панели друг под другом, cols - рядом колонками */
export type DockMode = 'stack' | 'cols';

export interface Dock {
  mode: DockMode;
  items: PanelId[]; // сверху вниз или слева направо
}

export interface PanelLayout {
  left: Dock;
  right: Dock;
}

export const PANEL_IDS: readonly PanelId[] = ['folders', 'tags'];
export const otherPanel = (id: PanelId): PanelId => (id === 'folders' ? 'tags' : 'folders');

export type PresetId = 'stack' | 'cols' | 'apart';

export const PRESETS: Record<PresetId, { label: string; hint: string; layout: PanelLayout }> = {
  stack: {
    label: 'Друг под другом слева',
    hint: 'папки сверху, теги снизу, граница тянется',
    layout: { left: { mode: 'stack', items: ['folders', 'tags'] }, right: { mode: 'stack', items: [] } },
  },
  cols: {
    label: 'Две колонки слева',
    hint: 'папки и теги рядом, у каждой своя ширина',
    layout: { left: { mode: 'cols', items: ['folders', 'tags'] }, right: { mode: 'stack', items: [] } },
  },
  apart: {
    label: 'Папки слева, теги справа',
    hint: 'теги по другую сторону галереи',
    layout: { left: { mode: 'stack', items: ['folders'] }, right: { mode: 'stack', items: ['tags'] } },
  },
};

export const DEFAULT_LAYOUT: PanelLayout = PRESETS.stack.layout;

/** Какой из готовых вариантов сейчас стоит (для галочки в меню). */
export function presetOf(layout: PanelLayout): PresetId | undefined {
  return (Object.keys(PRESETS) as PresetId[]).find((k) => sameLayout(PRESETS[k].layout, layout));
}

function sameDock(a: Dock, b: Dock): boolean {
  return a.items.length === b.items.length && a.items.every((p, i) => p === b.items[i]) && (a.items.length < 2 || a.mode === b.mode);
}

export function sameLayout(a: PanelLayout, b: PanelLayout): boolean {
  return sameDock(a.left, b.left) && sameDock(a.right, b.right);
}

/** Сторона и место панели. */
export function locate(layout: PanelLayout, id: PanelId): { side: DockSide; index: number } {
  const index = layout.left.items.indexOf(id);
  return index >= 0 ? { side: 'left', index } : { side: 'right', index: layout.right.items.indexOf(id) };
}

/** У одинокой панели режим не важен - считаем его stack, чтобы сравнение и вёрстка были однозначны. */
function normalize(layout: PanelLayout): PanelLayout {
  const fix = (d: Dock): Dock => (d.items.length < 2 && d.mode !== 'stack' ? { ...d, mode: 'stack' } : d);
  return { left: fix(layout.left), right: fix(layout.right) };
}

/**
 * Разбор сохранённой раскладки: каждая панель ровно один раз, иначе - по умолчанию.
 * Сохранённое могло испортиться или прийти от старой версии.
 */
export function parseLayout(value: unknown): PanelLayout {
  const dock = (v: unknown): Dock | null => {
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Record<string, unknown>;
    if (r.mode !== 'stack' && r.mode !== 'cols') return null;
    if (!Array.isArray(r.items) || !r.items.every((p) => p === 'folders' || p === 'tags')) return null;
    return { mode: r.mode, items: [...(r.items as PanelId[])] };
  };
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT;
  const r = value as Record<string, unknown>;
  const left = dock(r.left);
  const right = dock(r.right);
  if (left === null || right === null) return DEFAULT_LAYOUT;
  const all = [...left.items, ...right.items];
  if (all.length !== PANEL_IDS.length || PANEL_IDS.some((p) => !all.includes(p))) return DEFAULT_LAYOUT;
  return normalize({ left, right });
}

/** Куда бросили перетаскиваемую панель. */
export type DropTarget =
  | { kind: 'panel'; edge: 'top' | 'bottom' | 'left' | 'right' } // на другую панель: над, под, слева, справа от неё
  | { kind: 'edge'; side: DockSide }; // к краю галереи: отдельной крайней колонкой

/** Новая раскладка после переноса панели id; прежняя не меняется. */
export function dockPanel(layout: PanelLayout, id: PanelId, target: DropTarget): PanelLayout {
  const other = otherPanel(id);
  const next: PanelLayout = {
    left: { ...layout.left, items: layout.left.items.filter((p) => p !== id) },
    right: { ...layout.right, items: layout.right.items.filter((p) => p !== id) },
  };
  if (target.kind === 'panel') {
    const side = next.left.items.includes(other) ? 'left' : 'right';
    const first = target.edge === 'top' || target.edge === 'left';
    next[side] = {
      mode: target.edge === 'top' || target.edge === 'bottom' ? 'stack' : 'cols',
      items: first ? [id, other] : [other, id],
    };
  } else {
    const d = next[target.side];
    // у края окна панель становится крайней колонкой
    next[target.side] =
      d.items.length === 0
        ? { mode: 'stack', items: [id] }
        : { mode: 'cols', items: target.side === 'left' ? [id, ...d.items] : [...d.items, id] };
  }
  return normalize(next);
}

// ── Размеры ─────────────────────────────────────────────────────────────────

/** Ширины в пикселях, доли высоты (верхняя панель в стопке) - от 0 до 1. */
export interface PanelSizes {
  dockLeft: number; // ширина левой стопки
  dockRight: number;
  splitLeft: number; // доля высоты верхней панели левой стопки
  splitRight: number;
  folders: number; // ширина панели в режиме колонок
  tags: number;
}

export type SizeKey = keyof PanelSizes;

export const DEFAULT_SIZES: PanelSizes = {
  dockLeft: 260,
  dockRight: 250,
  splitLeft: 0.42,
  splitRight: 0.5,
  folders: 230,
  tags: 250,
};

export const MIN_WIDTH = 170;
export const MAX_WIDTH = 520;
export const MIN_SPLIT = 0.12;
export const MAX_SPLIT = 0.88;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const isSplitKey = (key: SizeKey): boolean => key === 'splitLeft' || key === 'splitRight';

export function clampSize(key: SizeKey, value: number): number {
  return isSplitKey(key) ? clamp(value, MIN_SPLIT, MAX_SPLIT) : Math.round(clamp(value, MIN_WIDTH, MAX_WIDTH));
}

export function parseSizes(value: unknown): PanelSizes {
  const out = { ...DEFAULT_SIZES };
  if (typeof value !== 'object' || value === null) return out;
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SIZES) as SizeKey[]) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clampSize(key, v);
  }
  return out;
}

// ── Геометрия перетаскивания ────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DropHit {
  target: DropTarget;
  preview: Rect; // где подсветить будущее место
}

/** Полоса у края галереи, бросок в которую ставит панель отдельной колонкой. */
export const EDGE_ZONE = 150;
const EDGE_PREVIEW = 250;

const inside = (r: Rect, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

/**
 * Что под курсором при перетаскивании: другая панель (ближайший край - над, под,
 * слева, справа от неё) или кромка галереи. null - бросать некуда.
 */
export function hitTest(x: number, y: number, otherRect: Rect | null, contentRect: Rect): DropHit | null {
  if (otherRect !== null && inside(otherRect, x, y)) {
    const r = otherRect;
    const dx = (x - r.left) / r.width;
    const dy = (y - r.top) / r.height;
    const edges = [
      ['top', dy],
      ['bottom', 1 - dy],
      ['left', dx],
      ['right', 1 - dx],
    ] as const;
    const [edge] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
    const halfW = r.width / 2;
    const halfH = r.height / 2;
    const preview: Rect = {
      top: { left: r.left, top: r.top, width: r.width, height: halfH },
      bottom: { left: r.left, top: r.top + halfH, width: r.width, height: halfH },
      left: { left: r.left, top: r.top, width: halfW, height: r.height },
      right: { left: r.left + halfW, top: r.top, width: halfW, height: r.height },
    }[edge];
    return { target: { kind: 'panel', edge }, preview };
  }
  const c = contentRect;
  if (y < c.top || y > c.top + c.height) return null;
  const width = Math.min(EDGE_PREVIEW, c.width / 2);
  if (x >= c.left && x < c.left + EDGE_ZONE) {
    return { target: { kind: 'edge', side: 'left' }, preview: { left: c.left, top: c.top, width, height: c.height } };
  }
  const right = c.left + c.width;
  if (x <= right && x > right - EDGE_ZONE) {
    return { target: { kind: 'edge', side: 'right' }, preview: { left: right - width, top: c.top, width, height: c.height } };
  }
  return null;
}
