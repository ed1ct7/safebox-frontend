import { useId, useMemo, useState } from 'react';
import type { TagMatch } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { addFilterTag, EMPTY_FILTER, isFilterActive, removeFilterTag } from '../lib/tagFilter';
import type { FilterScope, TagFilter } from '../lib/tagFilter';
import { tagText } from '../lib/tags';
import type { CatalogTag } from '../lib/tags';
import { chipButtonClass, chipClass, TagText } from './TagChip';
import { TagCombobox } from './TagCombobox';

const MATCH_OPTIONS: { value: TagMatch; label: string; hint: string }[] = [
  {
    value: 'categories',
    label: 'И между категориями, ИЛИ внутри',
    hint: 'character:eris + character:roxy + language:ru = (eris или roxy) и ru',
  },
  { value: 'all', label: 'Все И', hint: 'у записи есть все выбранные теги' },
  { value: 'any', label: 'Все ИЛИ', hint: 'у записи есть хотя бы один из выбранных тегов' },
];

function Radio<T extends string>({
  name,
  value,
  current,
  label,
  hint,
  disabled = false,
  onSelect,
}: {
  name: string;
  value: T;
  current: T;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <label
      title={hint}
      className={`flex items-center gap-2 text-xs ${disabled ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-300'}`}
    >
      <input
        type="radio"
        name={name}
        checked={current === value}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="accent-indigo-500"
      />
      {label}
    </label>
  );
}

/**
 * Фильтр по тегам рядом с поиском (UF-18): кнопка открывает поповер с полем выбора
 * (тот же комбобокс, но без создания тегов), выбранными чипами, режимом сочетания
 * и областью «весь сейф / в этой папке». Фильтр действует сразу, без кнопки «Применить».
 * canScopeFolder - открыта папка или запись; в корне «в этой папке» = весь сейф.
 */
export function TagFilterButton({
  filter,
  canScopeFolder,
  onChange,
  className,
}: {
  filter: TagFilter;
  canScopeFolder: boolean;
  onChange: (filter: TagFilter) => void;
  className: string;
}) {
  const catalog = useTagCatalog();
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);

  const selected = useMemo(
    () => filter.tags.flatMap((id) => catalog.tags.get(id) ?? []),
    [filter.tags, catalog],
  );
  const exclude = useMemo(() => new Set(filter.tags), [filter.tags]);
  const active = isFilterActive(filter);
  // в корне «в этой папке» ничего не меняет - показываем, что действует весь сейф
  const scope: FilterScope = canScopeFolder ? filter.scope : 'vault';

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`${className} ${active ? 'border-accent text-zinc-100' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Фильтр по тегам"
        onClick={() => setOpen((o) => !o)}
      >
        Фильтр
        {active && (
          <span className="rounded-full bg-accent px-1.5 text-xs leading-5 text-white" aria-label={`Выбрано тегов: ${filter.tags.length}`}>
            {filter.tags.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Фильтр по тегам"
          className="absolute right-0 top-full z-50 mt-1 w-96 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl"
        >
          <TagCombobox
            label="Выбрать тег для фильтра"
            placeholder="категория:тег"
            allowCreate={false}
            autoFocus
            floating
            exclude={exclude}
            onPick={async (tag: CatalogTag) => onChange(addFilterTag(filter, tag.id))}
          />

          {selected.length > 0 && (
            <ul aria-label="Выбранные теги" className="mt-2.5 flex flex-wrap gap-1.5">
              {selected.map((tag) => (
                <li key={tag.id} className={chipClass()}>
                  <span className="min-w-0 truncate">
                    <TagText category={tag.category} name={tag.name} />
                  </span>
                  <button
                    type="button"
                    aria-label={`Убрать из фильтра «${tagText(tag)}»`}
                    title="Убрать из фильтра"
                    className={chipButtonClass}
                    onClick={() => onChange(removeFilterTag(filter, tag.id))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div role="radiogroup" aria-label="Сочетание тегов" className="mt-3 flex flex-col gap-1.5">
            {MATCH_OPTIONS.map((o) => (
              <Radio
                key={o.value}
                name={`${groupName}-match`}
                value={o.value}
                current={filter.match}
                label={o.label}
                hint={o.hint}
                onSelect={(match) => onChange({ ...filter, match })}
              />
            ))}
          </div>

          <div role="radiogroup" aria-label="Область поиска" className="mt-3 flex gap-4 border-t border-zinc-800 pt-3">
            <Radio<FilterScope>
              name={`${groupName}-scope`}
              value="vault"
              current={scope}
              label="Весь сейф"
              onSelect={(scope) => onChange({ ...filter, scope })}
            />
            <Radio<FilterScope>
              name={`${groupName}-scope`}
              value="folder"
              current={scope}
              label="В этой папке"
              hint={canScopeFolder ? 'Вместе с вложениями, рекурсивно' : 'Откройте папку, чтобы искать только в ней'}
              disabled={!canScopeFolder}
              onSelect={(scope) => onChange({ ...filter, scope })}
            />
          </div>

          {active && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-zinc-400 transition hover:text-zinc-200"
                onClick={() => onChange({ ...EMPTY_FILTER, match: filter.match, scope: filter.scope })}
              >
                Сбросить фильтр
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
