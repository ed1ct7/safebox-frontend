import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useDismiss } from '../hooks/useDismiss';
import { usePanelLayout } from '../hooks/usePanelLayout';
import type { PanelLayoutApi } from '../hooks/usePanelLayout';
import { PRESETS, clampSize, hitTest, isSplitKey, otherPanel, presetOf } from '../lib/panelLayout';
import type { DockSide, DropHit, PanelId, PresetId, Rect, SizeKey } from '../lib/panelLayout';

/** Содержимое панели: заголовок, кнопки в шапке и тело (оно само прокручивается). */
export interface PanelSpec {
  title: string;
  /** Имя области для скринридера и тестов, по умолчанию - title. */
  label?: string;
  /** Рядом с заголовком: счётчик и т.п. */
  badge?: ReactNode;
  /** Кнопки справа в шапке. */
  actions?: ReactNode;
  children: ReactNode;
}

interface DragView {
  id: PanelId;
  x: number;
  y: number;
  hit: DropHit | null;
  center: Rect;
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** Что мешает начать перетаскивание с шапки: свои кнопки и поля. */
const INTERACTIVE = 'button, input, select, textarea, a, [role="radiogroup"], [role="menu"]';

/**
 * Рабочая область с боковыми панелями «Папки» и «Теги», как окна в Visual Studio:
 * обе видны сразу; шапку панели можно утащить на другую панель (встанет над, под
 * или рядом колонкой) или к краю галереи (уйдёт на ту сторону). Ширины и граница
 * между панелями тянутся мышью или стрелками, двойной щелчок по границе
 * возвращает размер. Готовые раскладки - в меню ⋯ в шапке. Всё запоминается.
 * children - середина: галерея и то, что рядом с ней.
 */
export function DockedWorkspace({ panels, children }: { panels: Record<PanelId, PanelSpec>; children: ReactNode }) {
  const api = usePanelLayout();
  const rootRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragView | null>(null);

  const startDrag = (id: PanelId, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    const root = rootRef.current;
    const centerEl = centerRef.current;
    if (root === null || centerEl === null) return;
    e.preventDefault(); // не выделять текст
    const sx = e.clientX;
    const sy = e.clientY;
    const otherEl = root.querySelector(`[data-panel="${otherPanel(id)}"]`);
    // раскладка за время переноса не меняется - размеры снимаем один раз
    const otherRect = otherEl === null ? null : toRect(otherEl.getBoundingClientRect());
    const center = toRect(centerEl.getBoundingClientRect());
    let active = false;
    let hit: DropHit | null = null;

    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('sbx-panel-drag');
      if (active && drop && hit !== null) api.dock(id, hit.target);
      setDrag(null);
    };
    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        active = true;
        document.body.classList.add('sbx-panel-drag');
      }
      hit = hitTest(ev.clientX, ev.clientY, otherRect, center);
      setDrag({ id, x: ev.clientX, y: ev.clientY, hit, center });
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active) return;
      ev.stopPropagation(); // Escape отменяет перенос, а не снимает выделение в галерее
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    document.addEventListener('keydown', onKey, true);
  };

  const dockProps = { api, panels, dragging: drag?.id ?? null, onStartDrag: startDrag };

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1">
      <Dock side="left" {...dockProps} />
      <div ref={centerRef} className="flex min-w-0 flex-1">
        {children}
      </div>
      <Dock side="right" {...dockProps} />
      {drag !== null && <DragOverlay drag={drag} title={panels[drag.id].title} />}
    </div>
  );
}

function DragOverlay({ drag, title }: { drag: DragView; title: string }) {
  const zone = 150;
  const c = drag.center;
  const where =
    drag.hit === null
      ? null
      : drag.hit.target.kind === 'edge'
        ? drag.hit.target.side === 'left'
          ? 'Слева от галереи'
          : 'Справа от галереи'
        : { top: 'Сверху', bottom: 'Снизу', left: 'Колонкой слева', right: 'Колонкой справа' }[drag.hit.target.edge];
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      {/* полосы у краёв галереи: сюда можно бросить */}
      <div
        className="fixed rounded-lg border border-dashed border-accent/40 bg-accent/5"
        style={{ left: c.left, top: c.top, width: zone, height: c.height }}
      />
      <div
        className="fixed rounded-lg border border-dashed border-accent/40 bg-accent/5"
        style={{ left: c.left + c.width - zone, top: c.top, width: zone, height: c.height }}
      />
      {drag.hit !== null && (
        <div
          className="fixed flex items-center justify-center rounded-lg border-2 border-accent bg-accent/20 p-2 text-center text-sm font-semibold text-white transition-all duration-75"
          style={drag.hit.preview}
        >
          {where}
        </div>
      )}
      <div
        className="fixed flex items-center gap-1.5 rounded-lg border border-accent bg-zinc-800 px-2.5 py-1 text-xs text-zinc-100 shadow-xl"
        style={{ left: drag.x + 12, top: drag.y + 10 }}
      >
        <span className="text-zinc-500">⠿</span>
        {title}
      </div>
    </div>
  );
}

interface DockProps {
  side: DockSide;
  api: PanelLayoutApi;
  panels: Record<PanelId, PanelSpec>;
  dragging: PanelId | null;
  onStartDrag: (id: PanelId, e: ReactPointerEvent<HTMLElement>) => void;
}

function Dock({ side, api, panels, dragging, onStartDrag }: DockProps) {
  const dock = api.layout[side];
  if (dock.items.length === 0) return null;
  const border = side === 'left' ? 'border-r' : 'border-l';
  const widthKey: SizeKey = side === 'left' ? 'dockLeft' : 'dockRight';
  const splitKey: SizeKey = side === 'left' ? 'splitLeft' : 'splitRight';
  const dir = side === 'left' ? 1 : -1; // в какую сторону от мыши растёт ширина

  const panel = (id: PanelId, style: CSSProperties | undefined, extra?: ReactNode) => (
    <Panel
      key={id}
      id={id}
      side={side}
      spec={panels[id]}
      api={api}
      style={style}
      canCollapse={dock.mode === 'stack' && dock.items.length > 1}
      lifted={dragging === id}
      onStartDrag={onStartDrag}
    >
      {extra}
    </Panel>
  );

  if (dock.mode === 'cols') {
    return (
      <div data-dock={side} className={`flex shrink-0 border-zinc-800 bg-zinc-950 ${border}`}>
        {dock.items.map((id) =>
          panel(
            id,
            { width: api.sizes[id] },
            <Splitter
              api={api}
              sizeKey={id}
              dir={dir}
              target={() => document.querySelector<HTMLElement>(`[data-panel="${id}"]`)}
              className={side === 'left' ? '-right-1' : '-left-1'}
              label={`Ширина панели «${panels[id].title}»`}
            />,
          ),
        ).flatMap((el, i) => (i === 0 ? [el] : [<div key={`sep${i}`} className="w-px shrink-0 bg-zinc-800" />, el]))}
      </div>
    );
  }

  const [first, second] = dock.items;
  const firstOpen = first !== undefined && !api.collapsed.has(first);
  const secondOpen = second !== undefined && !api.collapsed.has(second);
  const split = api.sizes[splitKey];
  const firstStyle =
    second === undefined || !firstOpen
      ? undefined
      : secondOpen
        ? { flex: `0 0 ${split * 100}%` }
        : { flex: '1 1 0' };

  return (
    <div
      data-dock={side}
      className={`relative flex shrink-0 flex-col border-zinc-800 bg-zinc-950 ${border}`}
      style={{ width: api.sizes[widthKey] }}
    >
      {first !== undefined && panel(first, firstStyle)}
      {second !== undefined && firstOpen && secondOpen && (
        <Splitter
          api={api}
          sizeKey={splitKey}
          dir={1}
          target={() => document.querySelector<HTMLElement>(`[data-dock="${side}"]`)}
          className=""
          label="Граница между панелями"
        />
      )}
      {second !== undefined && (
        <div className="h-px shrink-0 bg-zinc-800" />
      )}
      {second !== undefined && panel(second, secondOpen ? { flex: '1 1 0' } : undefined)}
      <Splitter
        api={api}
        sizeKey={widthKey}
        dir={dir}
        target={() => document.querySelector<HTMLElement>(`[data-dock="${side}"]`)}
        className={side === 'left' ? '-right-1' : '-left-1'}
        label="Ширина боковой панели"
      />
    </div>
  );
}

interface PanelProps {
  id: PanelId;
  side: DockSide;
  spec: PanelSpec;
  api: PanelLayoutApi;
  style: CSSProperties | undefined;
  canCollapse: boolean;
  lifted: boolean;
  onStartDrag: (id: PanelId, e: ReactPointerEvent<HTMLElement>) => void;
  children?: ReactNode; // разделитель ширины для режима колонок
}

function Panel({ id, side, spec, api, style, canCollapse, lifted, onStartDrag, children }: PanelProps) {
  const collapsed = canCollapse && api.collapsed.has(id);
  return (
    <section
      data-panel={id}
      aria-label={spec.label ?? spec.title}
      className={`group/panel relative flex min-h-0 min-w-0 flex-col ${collapsed ? 'shrink-0' : ''} ${
        lifted ? 'opacity-40' : ''
      }`}
      style={collapsed ? undefined : style}
    >
      <div
        title="Перетащите за заголовок, чтобы переставить панель"
        className="flex h-9 shrink-0 cursor-grab select-none items-center gap-1 pl-1.5 pr-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400 active:cursor-grabbing"
        onPointerDown={(e) => onStartDrag(id, e)}
      >
        {canCollapse ? (
          <button
            type="button"
            aria-label={`Панель «${spec.title}»`}
            aria-expanded={!collapsed}
            title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
            className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={() => api.toggleCollapsed(id)}
          >
            <span className={`inline-block w-3 text-center text-[10px] transition ${collapsed ? '' : 'rotate-90'}`}>▸</span>
          </button>
        ) : (
          <span aria-hidden="true" className="w-4 text-center text-zinc-600 opacity-0 transition group-hover/panel:opacity-80">
            ⠿
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{spec.title}</span>
          {spec.badge}
        </span>
        {spec.actions}
        <LayoutMenu api={api} side={side} />
      </div>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">{spec.children}</div>}
      {children}
    </section>
  );
}

function LayoutMenu({ api, side }: { api: PanelLayoutApi; side: DockSide }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const current = presetOf(api.layout);
  const pick = (p: PresetId) => {
    api.applyPreset(p);
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Расположение панелей"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Расположение панелей"
        className="rounded px-1.5 text-sm leading-6 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-200"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Расположение панелей"
          className={`absolute top-full z-50 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-1 normal-case tracking-normal shadow-xl ${
            side === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-normal text-zinc-500">
            Или перетащите панель за заголовок
          </p>
          {(Object.keys(PRESETS) as PresetId[]).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={current === p}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-zinc-200 transition hover:bg-zinc-800"
              onClick={() => pick(p)}
            >
              <span className="w-3 shrink-0 text-accent">{current === p ? '✓' : ''}</span>
              <span>
                {PRESETS[p].label}
                <span className="block text-xs text-zinc-500">{PRESETS[p].hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-zinc-800" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-zinc-300 transition hover:bg-zinc-800"
            onClick={() => {
              api.resetSizes();
              setOpen(false);
            }}
          >
            <span className="w-3 shrink-0" />
            Вернуть размеры
          </button>
        </div>
      )}
    </div>
  );
}

const WIDTH_STEP = 16;
const SPLIT_STEP = 0.04;

/**
 * Граница, которую тянут мышью: ширина дока/панели (вертикальная полоса) или доля
 * верхней панели в стопке (горизонтальная). Пока тянут, стиль меняется прямо в DOM -
 * без перерисовки всего окна; в состояние размер попадает при отпускании.
 */
function Splitter({
  api,
  sizeKey,
  dir,
  target,
  className,
  label,
}: {
  api: PanelLayoutApi;
  sizeKey: SizeKey;
  dir: 1 | -1;
  target: () => HTMLElement | null;
  className: string;
  label: string;
}) {
  const [active, setActive] = useState(false);
  const horizontal = isSplitKey(sizeKey);
  const value = api.sizes[sizeKey];

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = target();
    if (el === null) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const box = el.getBoundingClientRect();
    // в стопке размер задаёт первая панель дока
    const firstPanel = horizontal ? el.querySelector<HTMLElement>('[data-panel]') : null;
    let next = value;
    setActive(true);
    document.body.classList.add(horizontal ? 'sbx-resize-row' : 'sbx-resize-col');

    const onMove = (ev: PointerEvent) => {
      if (horizontal) {
        next = clampSize(sizeKey, (ev.clientY - box.top) / box.height);
        if (firstPanel !== null) firstPanel.style.flex = `0 0 ${next * 100}%`;
      } else {
        next = clampSize(sizeKey, value + dir * (ev.clientX - sx));
        el.style.width = `${next}px`;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      document.body.classList.remove('sbx-resize-row', 'sbx-resize-col');
      setActive(false);
      api.setSize(sizeKey, next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys: Partial<Record<string, number>> = horizontal
      ? { ArrowUp: -SPLIT_STEP, ArrowDown: SPLIT_STEP }
      : { ArrowLeft: -WIDTH_STEP, ArrowRight: WIDTH_STEP };
    const delta = keys[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    api.setSize(sizeKey, value + (horizontal ? delta : dir * delta));
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={horizontal ? Math.round(value * 100) : value}
      tabIndex={0}
      title="Потяните, чтобы изменить размер; двойной щелчок - как было"
      className={`group/split z-10 shrink-0 outline-none ${
        horizontal
          ? 'relative -my-[3px] h-[7px] cursor-row-resize'
          : `absolute bottom-0 top-0 w-[7px] cursor-col-resize ${className}`
      }`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => api.resetSize(sizeKey)}
      onKeyDown={onKeyDown}
    >
      <div
        className={`absolute bg-accent transition-opacity group-hover/split:opacity-80 group-focus-visible/split:opacity-80 ${
          active ? 'opacity-80' : 'opacity-0'
        } ${horizontal ? 'inset-x-0 top-[2px] h-[3px]' : 'inset-y-0 left-[2px] w-[3px]'}`}
      />
    </div>
  );
}
