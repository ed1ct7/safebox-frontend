import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SIZES,
  PRESETS,
  clampSize,
  dockPanel,
  parseLayout,
  parseSizes,
} from '../lib/panelLayout';
import type { DropTarget, PanelId, PanelLayout, PanelSizes, PresetId, SizeKey } from '../lib/panelLayout';

// Раскладка панелей «Папки» и «Теги» в localStorage: где стоят, размеры, какие
// свернуты. Ошибки чтения и записи молча игнорируются - раскладка просто
// вернётся к исходной (приватный режим, переполнение квоты).

export const PANELS_STORAGE_KEY = 'sbx_panels';

interface Stored {
  layout: PanelLayout;
  sizes: PanelSizes;
  collapsed: PanelId[];
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(PANELS_STORAGE_KEY);
    if (raw !== null) {
      const r = JSON.parse(raw) as Record<string, unknown> | null;
      if (typeof r === 'object' && r !== null) {
        const collapsed = Array.isArray(r.collapsed)
          ? r.collapsed.filter((p): p is PanelId => p === 'folders' || p === 'tags')
          : [];
        return { layout: parseLayout(r.layout), sizes: parseSizes(r.sizes), collapsed };
      }
    }
  } catch {
    // испорченное значение - начинаем с исходной раскладки
  }
  return { layout: DEFAULT_LAYOUT, sizes: DEFAULT_SIZES, collapsed: [] };
}

export interface PanelLayoutApi {
  layout: PanelLayout;
  sizes: PanelSizes;
  collapsed: ReadonlySet<PanelId>;
  dock: (id: PanelId, target: DropTarget) => void;
  applyPreset: (preset: PresetId) => void;
  setSize: (key: SizeKey, value: number) => void;
  resetSize: (key: SizeKey) => void;
  resetSizes: () => void;
  toggleCollapsed: (id: PanelId) => void;
}

export function usePanelLayout(): PanelLayoutApi {
  const [state, setState] = useState<Stored>(load);

  useEffect(() => {
    try {
      localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // не сохранилось - раскладка доживёт только до перезагрузки
    }
  }, [state]);

  // перенос панели разворачивает её: свернутой в новом месте её легко потерять
  const dock = useCallback((id: PanelId, target: DropTarget) => {
    setState((s) => ({ ...s, layout: dockPanel(s.layout, id, target), collapsed: s.collapsed.filter((p) => p !== id) }));
  }, []);
  const applyPreset = useCallback((preset: PresetId) => {
    setState((s) => ({ ...s, layout: PRESETS[preset].layout, collapsed: [] }));
  }, []);
  const setSize = useCallback((key: SizeKey, value: number) => {
    setState((s) => ({ ...s, sizes: { ...s.sizes, [key]: clampSize(key, value) } }));
  }, []);
  const resetSize = useCallback((key: SizeKey) => {
    setState((s) => ({ ...s, sizes: { ...s.sizes, [key]: DEFAULT_SIZES[key] } }));
  }, []);
  const resetSizes = useCallback(() => setState((s) => ({ ...s, sizes: DEFAULT_SIZES })), []);
  const toggleCollapsed = useCallback((id: PanelId) => {
    setState((s) => ({
      ...s,
      collapsed: s.collapsed.includes(id) ? s.collapsed.filter((p) => p !== id) : [...s.collapsed, id],
    }));
  }, []);

  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);

  return {
    layout: state.layout,
    sizes: state.sizes,
    collapsed,
    dock,
    applyPreset,
    setSize,
    resetSize,
    resetSizes,
    toggleCollapsed,
  };
}
