import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foldersQuery } from '../api/queries';
import type { TagMatch } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { addFilterTag, removeFilterTag } from '../lib/tagFilter';
import type { FilterScope, TagFilter } from '../lib/tagFilter';
import { tagText } from '../lib/tags';
import type { CatalogTag } from '../lib/tags';
import { TagCombobox } from './TagCombobox';

const MATCH_OPTIONS: { value: TagMatch; label: string; hint: string }[] = [
  {
    value: 'categories',
    label: 'И между категориями, ИЛИ внутри',
    hint: 'character:eris + character:roxy + language:ru = (eris или roxy) и ru',
  },
  { value: 'all', label: 'Все теги сразу (И)', hint: 'у записи есть все выбранные теги' },
  { value: 'any', label: 'Любой из тегов (ИЛИ)', hint: 'у записи есть хотя бы один из выбранных тегов' },
];

/** Выбранные теги по категориям в порядке выбора: «Место: Грузия или Стамбул». */
function groupByCategory(tags: readonly CatalogTag[]): { id: number; label: string; tags: CatalogTag[] }[] {
  const groups: { id: number; label: string; tags: CatalogTag[] }[] = [];
  for (const t of tags) {
    const g = groups.find((x) => x.id === t.categoryId);
    if (g === undefined) groups.push({ id: t.categoryId, label: t.categoryLabel, tags: [t] });
    else g.tags.push(t);
  }
  return groups;
}

const joinerClass = 'shrink-0 text-xs text-zinc-500';

/**
 * Строка фильтра по тегам над галереей (UF-18): что выбрано - фразой, как читается
 * запрос («Место: Грузия или Стамбул и Тема: еда»), у каждого тега крестик.
 * Рядом: «+ тег» с поиском, сочетание тегов, область (весь сейф или открытая папка)
 * и «Сбросить». Видна, только пока фильтр задан; теги выбираются галочками в панели
 * «Теги» или здесь. Фильтр действует сразу. folderId - открытая папка или запись,
 * null - корень (тогда «в папке» - то же, что весь сейф, и выбрать её нельзя).
 */
export function FilterBar({
  filter,
  folderId,
  onChange,
}: {
  filter: TagFilter;
  folderId: number | null;
  onChange: (filter: TagFilter) => void;
}) {
  const catalog = useTagCatalog();
  const picked = useMemo(() => filter.tags.flatMap((id) => catalog.tags.get(id) ?? []), [filter.tags, catalog]);
  const groups = useMemo(() => groupByCategory(picked), [picked]);
  const folderName = useQuery({
    ...foldersQuery,
    select: (r) => r.folders.find((f) => f.id === folderId)?.name,
    enabled: folderId !== null,
  }).data;
  const canScopeFolder = folderId !== null;
  // в корне «в папке» ничего не меняет - показываем, что действует весь сейф
  const scope: FilterScope = canScopeFolder ? filter.scope : 'vault';
  const inner = filter.match === 'all' ? 'и' : 'или';
  const outer = filter.match === 'any' ? 'или' : 'и';

  return (
    <section
      aria-label="Фильтр по тегам"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-zinc-800 bg-zinc-950 px-4 py-2"
    >
      <span className="shrink-0 text-xs text-zinc-500">Показаны:</span>
      <ul aria-label="Выбранные теги" className="contents">
        {groups.map((g, gi) => (
          <li key={g.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
            {gi > 0 && <span className={joinerClass}>{outer}</span>}
            <span className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 py-0.5 pl-2 pr-1">
              <span className="shrink-0 text-xs text-zinc-500">{g.label}:</span>
              {g.tags.map((t, ti) => (
                <span key={t.id} className="flex items-center gap-1">
                  {ti > 0 && <span className={joinerClass}>{inner}</span>}
                  <span className="flex items-center rounded-md bg-accent/20 pl-1.5 text-[13px] text-zinc-100">
                    <span className="max-w-[16rem] truncate">{t.label}</span>
                    <button
                      type="button"
                      aria-label={`Убрать из фильтра «${tagText(t)}»`}
                      title="Убрать из фильтра"
                      className="rounded-md px-1.5 text-xs text-zinc-400 transition hover:bg-accent/30 hover:text-white"
                      onClick={() => onChange(removeFilterTag(filter, t.id))}
                    >
                      ✕
                    </button>
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <AddTag filter={filter} onChange={onChange} />

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <select
          aria-label="Сочетание тегов"
          title={MATCH_OPTIONS.find((o) => o.value === filter.match)?.hint}
          value={filter.match}
          onChange={(e) => onChange({ ...filter, match: e.target.value as TagMatch })}
          className="rounded-lg border border-zinc-800 bg-zinc-900 py-1 pl-2 pr-1 text-xs text-zinc-300 outline-none transition hover:border-zinc-600 focus:border-accent"
        >
          {MATCH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <span role="radiogroup" aria-label="Область поиска" className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <ScopeButton current={scope} value="vault" onSelect={(s) => onChange({ ...filter, scope: s })}>
            Весь сейф
          </ScopeButton>
          <ScopeButton
            current={scope}
            value="folder"
            disabled={!canScopeFolder}
            hint={canScopeFolder ? 'Вместе с вложениями, рекурсивно' : 'Откройте папку, чтобы искать только в ней'}
            onSelect={(s) => onChange({ ...filter, scope: s })}
          >
            {folderName === undefined ? 'В этой папке' : `В «${folderName}»`}
          </ScopeButton>
        </span>

        <button
          type="button"
          className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => onChange({ ...filter, tags: [] })}
        >
          Сбросить
        </button>
      </span>
    </section>
  );
}

function ScopeButton({
  value,
  current,
  disabled = false,
  hint,
  onSelect,
  children,
}: {
  value: FilterScope;
  current: FilterScope;
  disabled?: boolean;
  hint?: string;
  onSelect: (value: FilterScope) => void;
  children: string;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      title={hint}
      className={`max-w-[14rem] truncate rounded-md px-2 py-0.5 text-xs transition ${
        on
          ? 'bg-zinc-700 text-zinc-100'
          : disabled
            ? 'cursor-not-allowed text-zinc-600'
            : 'text-zinc-400 hover:text-zinc-100'
      }`}
      onClick={() => onSelect(value)}
    >
      {children}
    </button>
  );
}

/** «+ тег»: поле с подсказками прямо в строке фильтра. */
function AddTag({ filter, onChange }: { filter: TagFilter; onChange: (filter: TagFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const selected = useMemo(() => new Set(filter.tags), [filter.tags]);
  return (
    <div ref={ref} className="relative shrink-0">
      {open ? (
        <div className="w-56">
          <TagCombobox
            label="Добавить тег в фильтр"
            placeholder="тег"
            allowCreate={false}
            exclude={selected}
            floating
            autoFocus
            onPick={async (tag: CatalogTag) => {
              onChange(addFilterTag(filter, tag.id));
              setOpen(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          title="Добавить тег в фильтр"
          className="rounded-lg border border-dashed border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100"
          onClick={() => setOpen(true)}
        >
          + тег
        </button>
      )}
    </div>
  );
}
