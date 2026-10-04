import { useMemo, useState } from 'react';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { useTagCatalogUi } from '../hooks/useTagCatalogUi';
import { previewTags, searchCatalogGroups, tagText } from '../lib/tags';
import type { CatalogCategory, CatalogTag } from '../lib/tags';

/** Сколько тегов категории показывать в компактном виде; остальные - за «Ещё N». */
export const TAG_PREVIEW_LIMIT = 10;

/** Чип тега каталога: подпись и счётчик записей, выбранный подсвечен. */
function CatalogChip({
  tag,
  on,
  onToggle,
}: {
  tag: CatalogTag;
  on: boolean;
  onToggle: (tagId: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={`${tagText(tag)} — записей: ${tag.count}. Щёлкните, чтобы ${on ? 'убрать из' : 'добавить в'} фильтр`}
      className={`max-w-full truncate rounded-full border px-1.5 text-[11px] leading-5 transition ${
        on
          ? 'border-accent bg-accent/30 text-zinc-100'
          : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
      }`}
      onClick={() => onToggle(tag.id)}
    >
      {tag.label} <span className="text-zinc-500">{tag.count}</span>
    </button>
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

/** Категория-сворка: шапка с числом тегов, компактный ряд чипов, «Ещё N» / «Свернуть». */
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
  const { visible, hidden } = previewTags(category.tags, selected, full ? category.tags.length : limit);
  const hasSelected = category.tags.some((t) => selected.has(t.id));
  return (
    <section aria-label={`Категория ${category.label}`} className="mb-2.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        title={collapsed ? `Развернуть «${category.label}»` : `Свернуть «${category.label}»`}
        className="-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-zinc-800/60"
        onClick={() => onCollapsedChange(category.id, !collapsed)}
      >
        <span
          aria-hidden="true"
          className={`inline-block text-[10px] text-zinc-600 transition ${collapsed ? '' : 'rotate-90'}`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{category.label}</span>
        <span className="shrink-0 text-[10px] text-zinc-600" title="Тегов в категории">
          {category.tags.length}
        </span>
        {collapsed && hasSelected && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Есть выбранные теги" />
        )}
      </button>
      {!collapsed && (
        <>
          <div className="mt-1 flex flex-wrap gap-1">
            {visible.map((t) => (
              <CatalogChip key={t.id} tag={t} on={selected.has(t.id)} onToggle={onToggle} />
            ))}
          </div>
          {full ? (
            category.tags.length > limit && (
              <button
                type="button"
                title="Показать только популярные теги"
                className="mt-1 rounded px-1 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
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
                className="mt-1 rounded px-1 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
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
 * Каталог тегов для панелей (UF-18): слева под деревом папок и справа в фильтре.
 * Чтобы каталог не превращался в свалку, каждая категория - сворка, в раскрытой
 * видно несколько популярных тегов, остальные за «Ещё N»; поле «Фильтровать…»
 * ищет по обоим именам тегов и категорий. Выбранные теги закреплены впереди и
 * видны всегда, у свернутой категории с выбранными - точка. Состояние категорий
 * запоминается в localStorage под storageKey (у панелей оно отдельное).
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
    return <p className="text-xs text-zinc-600">Загрузка…</p>;
  }
  if (catalog.categories.length === 0) {
    return <p className="text-xs text-zinc-600">Тегов пока нет</p>;
  }

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Фильтровать…"
          aria-label="Фильтровать теги по имени"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-1 pl-2 pr-6 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-accent"
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

      <div className="mt-2">
        {searching ? (
          matches.length === 0 ? (
            <p className="text-xs text-zinc-600">Ничего не найдено</p>
          ) : (
            matches.map(({ category, tags }) => (
              <div key={category.id} className="mb-2.5">
                <p className="mb-1 truncate text-xs text-zinc-500" title={category.label}>
                  {category.label}
                </p>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <CatalogChip key={t.id} tag={t} on={selected.has(t.id)} onToggle={onToggle} />
                  ))}
                </div>
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
