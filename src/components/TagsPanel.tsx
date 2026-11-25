import { useMemo } from 'react';
import { addFilterTag, removeFilterTag } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { TagCatalogList } from './TagCatalogList';
import { TagLanguageSwitch } from './TagLanguageSwitch';

/**
 * Тело панели «Теги» (UF-18): каталог строками с галочками. Галочка добавляет тег
 * в фильтр, снятая - убирает; результат сразу в галерее, что выбрано - в строке
 * фильтра над ней. Состояние сворок запоминается.
 */
export function TagsPanelBody({
  filter,
  onToggleTag,
}: {
  filter: TagFilter;
  onToggleTag: (filter: TagFilter) => void;
}) {
  const selected = useMemo(() => new Set(filter.tags), [filter.tags]);
  const toggle = (tagId: number) =>
    onToggleTag(selected.has(tagId) ? removeFilterTag(filter, tagId) : addFilterTag(filter, tagId));
  return <TagCatalogList selected={selected} onToggle={toggle} storageKey="sbx_tags_sidebar" />;
}

/** Шапка панели «Теги»: язык имён (та же настройка, что в «Настройках») и экран управления (UF-17). */
export function TagsPanelActions({ onManage }: { onManage: () => void }) {
  return (
    <span className="flex items-center gap-1 normal-case tracking-normal">
      <TagLanguageSwitch compact labels={{ ru: 'RU', en: 'EN' }} />
      <button
        type="button"
        aria-label="Управление тегами"
        title="Управление тегами: переименовать, слить, удалить"
        className="rounded px-1.5 text-sm leading-6 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-200"
        onClick={onManage}
      >
        ⚙
      </button>
    </span>
  );
}
