import { useState } from 'react';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { addFilterTag, isFilterActive, removeFilterTag } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { tagText } from '../lib/tags';

/**
 * Секция «Теги» в левой колонке, под деревом папок: весь каталог по категориям
 * с числом записей. Клик по тегу включает его в фильтр (повторный - убирает;
 * можно набирать несколько), выбранные подсвечены, результат сразу в галерее.
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
  const catalog = useTagCatalog();
  const [open, setOpen] = useState(true);
  const selected = new Set(filter.tags);

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

      {open && (
        <div className="mt-2 px-4 pb-1">
          {catalog.categories.length === 0 ? (
            <p className="text-xs text-zinc-600">{catalog.ready ? 'Тегов пока нет' : 'Загрузка…'}</p>
          ) : (
            catalog.categories.map((c) => (
              <div key={c.id} className="mb-2">
                <p className="mb-1 truncate text-xs text-zinc-500" title={c.name}>
                  {c.name}
                </p>
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => {
                    const tag = catalog.tags.get(t.id);
                    if (tag === undefined) return null;
                    const on = selected.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        title={`${tagText(tag)} — записей: ${t.count}. Щёлкните, чтобы ${on ? 'убрать из' : 'добавить в'} фильтр`}
                        className={`max-w-full truncate rounded-full border px-1.5 text-[11px] leading-5 transition ${
                          on
                            ? 'border-accent bg-accent/30 text-zinc-100'
                            : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                        }`}
                        onClick={() => toggle(t.id)}
                      >
                        {t.name} <span className="text-zinc-500">{t.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
