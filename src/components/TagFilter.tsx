import { useId, useMemo } from 'react';
import type { TagMatch } from '../api/types';
import { useEscape } from '../hooks/useDismiss';
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
 * Панель фильтра по тегам, пришвартованная справа (UF-18). Сверху - поле с
 * автодополнением и выбранные чипы, ниже - режим сочетания и область, под ними
 * весь каталог: категории и теги с числом записей; клик по тегу включает его в
 * фильтр (или выключает) - можно выбирать, не набирая текст. Фильтр действует
 * сразу, без кнопки «Применить»; панель остаётся открытой, пока её не закрыть
 * (крестиком или Esc), и результат виден тут же в галерее. canScopeFolder -
 * открыта папка или запись; в корне «в этой папке» = весь сейф.
 */
export function FilterPanel({
  filter,
  canScopeFolder,
  onChange,
  onClose,
}: {
  filter: TagFilter;
  canScopeFolder: boolean;
  onChange: (filter: TagFilter) => void;
  onClose: () => void;
}) {
  const catalog = useTagCatalog();
  const groupName = useId();
  // Esc закрывает панель, даже если фокус в поле; Esc внутри комбобокса
  // (закрыть список, очистить поле) перехватывается раньше
  useEscape(onClose);

  const selected = useMemo(() => new Set(filter.tags), [filter.tags]);
  const picked = useMemo(
    () => filter.tags.flatMap((id) => catalog.tags.get(id) ?? []),
    [filter.tags, catalog],
  );
  const active = isFilterActive(filter);
  // в корне «в этой папке» ничего не меняет - показываем, что действует весь сейф
  const scope: FilterScope = canScopeFolder ? filter.scope : 'vault';

  return (
    <aside
      aria-label="Фильтр по тегам"
      className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950"
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-sm font-medium text-zinc-100">Фильтр по тегам</h2>
        <button
          type="button"
          aria-label="Закрыть панель фильтра"
          title="Закрыть (Esc)"
          className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="px-3">
        <TagCombobox
          label="Выбрать тег для фильтра"
          placeholder="тег"
          allowCreate={false}
          exclude={selected}
          onPick={async (tag: CatalogTag) => onChange(addFilterTag(filter, tag.id))}
        />

        {picked.length > 0 && (
          <ul aria-label="Выбранные теги" className="mt-2 flex flex-wrap gap-1.5">
            {picked.map((tag) => (
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
      </div>

      <div role="radiogroup" aria-label="Сочетание тегов" className="mt-3 flex flex-col gap-1.5 px-3">
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

      <div role="radiogroup" aria-label="Область поиска" className="mt-2.5 flex gap-4 border-b border-zinc-800 px-3 pb-2.5">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
          Все теги
        </p>
        {catalog.categories.length === 0 ? (
          <p className="text-xs text-zinc-600">{catalog.ready ? 'Тегов пока нет' : 'Загрузка…'}</p>
        ) : (
          catalog.categories.map((c) => (
            <section key={c.id} aria-label={`Категория ${c.name}`} className="mb-2.5">
              <h3 className="mb-1 text-xs text-zinc-400">{c.name}</h3>
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
                      onClick={() => onChange(on ? removeFilterTag(filter, t.id) : addFilterTag(filter, t.id))}
                    >
                      {t.name} <span className="text-zinc-500">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {active && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => onChange({ ...EMPTY_FILTER, match: filter.match, scope: filter.scope })}
          >
            Сбросить фильтр
          </button>
        </div>
      )}
    </aside>
  );
}
