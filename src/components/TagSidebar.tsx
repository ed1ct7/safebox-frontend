import { useMemo, useState } from 'react';
import { addFilterTag, isFilterActive, removeFilterTag } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { TagCatalogList } from './TagCatalogList';
import { TagLanguageSwitch } from './TagLanguageSwitch';

/**
 * Секция «Теги» в левой колонке, под деревом папок (UF-18): каталог тегов - категории-сворки,
 * несколько популярных тегов сразу, остальные за «Ещё N», поиск по имени. Клик по тегу
 * включает его в фильтр (повторный - убирает; можно набирать несколько), выбранные
 * подсвечены и закреплены, результат сразу в галерее. Состояние сворок запоминается.
 * RU/EN в заголовке - язык имён тегов (та же настройка, что в «Настройках»).
 * ⚙ открывает экран управления тегами (UF-17).
 */
export function TagSidebar({
  filter,
  onToggleTag,
  onManage,
}: {
  filter: TagFilter;
  onToggleTag: (filter: TagFilter) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(true);
  const selected = useMemo(() => new Set(filter.tags), [filter.tags]);

  const toggle = (tagId: number) =>
    onToggleTag(isFilterActive(filter) && selected.has(tagId) ? removeFilterTag(filter, tagId) : addFilterTag(filter, tagId));

  return (
    <section aria-label="Каталог тегов" className="mt-4 border-t border-zinc-800 pt-3">
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Раздел «Теги»"
            aria-expanded={open}
            title={open ? 'Свернуть раздел тегов' : 'Развернуть раздел тегов'}
            className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={() => setOpen((o) => !o)}
          >
            <span className={`inline-block text-[10px] transition ${open ? 'rotate-90' : ''}`}>▸</span>
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Теги</p>
        </div>
        <div className="flex items-center gap-1">
          <TagLanguageSwitch compact labels={{ ru: 'RU', en: 'EN' }} />
          <button
            type="button"
            aria-label="Управление тегами"
            title="Управление тегами: переименовать, слить, удалить"
            className="rounded px-1.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onManage}
          >
            ⚙
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 px-4 pb-1">
          <TagCatalogList selected={selected} onToggle={toggle} storageKey="sbx_tags_sidebar" />
        </div>
      )}
    </section>
  );
}
