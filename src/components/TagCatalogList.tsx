import { useMemo, useState } from 'react';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { useTagCatalogUi } from '../hooks/useTagCatalogUi';
import { previewTags, searchCatalogGroups, tagText } from '../lib/tags';
import type { CatalogCategory, CatalogTag } from '../lib/tags';

/** Сколько тегов категории показывать в компактном виде; остальные - за «Ещё N». */
export const TAG_PREVIEW_LIMIT = 10;

/** Строка тега: галочка, имя, число записей справа. Выбранные - в фильтре. */
function CatalogRow({
  tag,
  on,
  onToggle,
}: {
  tag: CatalogTag;
  on: boolean;
  onToggle: (tagId: number) => void;
}) {
  return (
    <label
      title={`${tagText(tag)} — записей: ${tag.count}`}
      // relative: скрытая галочка (sr-only - absolute) остаётся внутри строки; иначе она
      // вылезает из прокручиваемой панели, и окно уезжает вверх за фокусом
      className={`relative flex cursor-pointer items-center gap-2 rounded-md py-[3px] pl-5 pr-2 text-[13px] transition ${
        on ? 'bg-accent/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-100'
      }`}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={() => onToggle(tag.id)}
        aria-label={tag.label}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 ${
          on ? 'border-accent bg-accent text-white' : 'border-zinc-600'
        }`}
      >
        {on ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate">{tag.label}</span>
      <span className={`shrink-0 text-[11px] tabular-nums ${tag.count === 0 ? 'text-zinc-700' : 'text-zinc-500'}`}>
        {tag.count}
      </span>
    </label>
  );
}

interface CategorySectionProps {
  category: CatalogCategory;
  selected: ReadonlySet<number>;
  onToggle: (tagId: number) => void;
  limit: number;
  collapsed: boolean;
  full: boolean;
  onCollapsedChange: (id: number, collapsed: boolean) => void;
  onFullChange: (id: number, full: boolean) => void;
}

/** Категория-сворка: шапка с числом тегов, популярные строки, «Ещё N» / «Свернуть». */
function CategorySection({
  category,
  selected,
  onToggle,
  limit,
  collapsed,
  full,
  onCollapsedChange,
  onFullChange,
}: CategorySectionProps) {
  const { visible, hidden } = previewTags(category.tags, full ? category.tags.length : limit, selected);
  const chosen = category.tags.filter((t) => selected.has(t.id)).length;
  return (
    <section aria-label={`Категория ${category.label}`} className="mb-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        title={collapsed ? `Развернуть «${category.label}»` : `Свернуть «${category.label}»`}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition hover:bg-zinc-800/60"
        onClick={() => onCollapsedChange(category.id, !collapsed)}
      >
        <span
          aria-hidden="true"
          className={`inline-block w-3 text-center text-[10px] text-zinc-600 transition ${collapsed ? '' : 'rotate-90'}`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-400">{category.label}</span>
        {chosen > 0 && (
          <span className="shrink-0 rounded-full bg-accent/25 px-1.5 text-[10px] text-zinc-200" title="Выбрано в фильтре">
            {chosen}
          </span>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-600" title="Тегов в категории">
          {category.tags.length}
        </span>
      </button>
      {!collapsed && (
        <>
          {visible.map((t) => (
            <CatalogRow key={t.id} tag={t} on={selected.has(t.id)} onToggle={onToggle} />
          ))}
          {full ? (
            category.tags.length > limit && (
              <button
                type="button"
                title="Показать только популярные теги"
                className="ml-5 mt-0.5 rounded px-1 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                onClick={() => onFullChange(category.id, false)}
              >
                Свернуть
              </button>
            )
          ) : (
            hidden > 0 && (
              <button
                type="button"
                title={`Показать все ${category.tags.length} тегов категории`}
                className="ml-5 mt-0.5 rounded px-1 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                onClick={() => onFullChange(category.id, true)}
              >
                Ещё {hidden}…
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}

/**
 * Каталог тегов (UF-18) в панели «Теги»: строки с галочками по категориям-сворам.
 * Галочка - тег в фильтре (можно несколько), снять - убрать. В раскрытой категории
 * видны популярные теги, остальные за «Ещё N»; выбранные видны всегда и стоят на
 * своём месте (порядок не прыгает). Поле «Найти тег…» ищет по обоим языкам и по
 * категориям. Состояние сворок запоминается в localStorage под storageKey.
 */
export function TagCatalogList({
  selected,
  onToggle,
  storageKey,
  limit = TAG_PREVIEW_LIMIT,
}: {
  selected: ReadonlySet<number>;
  onToggle: (tagId: number) => void;
  storageKey: string;
  limit?: number;
}) {
  const catalog = useTagCatalog();
  const [query, setQuery] = useState('');
  const [ui, setUi] = useTagCatalogUi(storageKey);
  const searching = query.trim() !== '';
  const matches = useMemo(
    () => (searching ? searchCatalogGroups(catalog, query) : []),
    [catalog, query, searching],
  );

  if (!catalog.ready) {
    return <p className="px-3 text-xs text-zinc-600">Загрузка…</p>;
  }
  if (catalog.categories.length === 0) {
    return <p className="px-3 text-xs text-zinc-600">Тегов пока нет</p>;
  }

  return (
    <div>
      <div className="sticky top-0 z-[1] bg-zinc-950 px-2.5 pb-2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="Найти тег…"
            aria-label="Фильтровать теги по имени"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1 pl-2 pr-6 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-accent"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label="Очистить фильтр тегов"
              title="Очистить"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-[11px] text-zinc-500 transition hover:text-zinc-200"
              onClick={() => setQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="px-1.5 pb-2">
        {searching ? (
          matches.length === 0 ? (
            <p className="px-2 text-xs text-zinc-600">Ничего не найдено</p>
          ) : (
            matches.map(({ category, tags }) => (
              <div key={category.id} className="mb-1.5">
                <p className="truncate px-1 py-1 text-xs font-medium text-zinc-500" title={category.label}>
                  {category.label}
                </p>
                {tags.map((t) => (
                  <CatalogRow key={t.id} tag={t} on={selected.has(t.id)} onToggle={onToggle} />
                ))}
              </div>
            ))
          )
        ) : (
          catalog.categories.map((c) => (
            <CategorySection
              key={c.id}
              category={c}
              selected={selected}
              onToggle={onToggle}
              limit={limit}
              collapsed={ui.collapsed.includes(c.id)}
              full={ui.full.includes(c.id)}
              onCollapsedChange={(id, collapsed) =>
                setUi((s) => ({
                  collapsed: collapsed ? [...s.collapsed, id] : s.collapsed.filter((x) => x !== id),
                  full: s.full,
                }))
              }
              onFullChange={(id, full) =>
                setUi((s) => ({
                  collapsed: s.collapsed,
                  full: full ? [...s.full, id] : s.full.filter((x) => x !== id),
                }))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
