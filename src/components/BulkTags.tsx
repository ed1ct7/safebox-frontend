import { useMemo, useState } from 'react';
import { errorMessage, isUnauthorized } from '../api/client';
import type { Entry } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { useTagActions } from '../hooks/useTagActions';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { plural } from '../lib/format';
import type { CreatePlan } from '../lib/tagInput';
import { selectionTags, tagText } from '../lib/tags';
import type { CatalogTag } from '../lib/tags';
import { chipButtonClass, TagText } from './TagChip';
import { TagCombobox } from './TagCombobox';
import { useToast } from './Toasts';

function BulkTagsPopover({ entries }: { entries: Entry[] }) {
  const catalog = useTagCatalog();
  const actions = useTagActions();
  const toast = useToast();
  const [inherit, setInherit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const rows = useMemo(() => selectionTags(entries, catalog), [entries, catalog]);

  const reportAdded = (updated: number) =>
    toast(
      updated === 0
        ? 'Тег уже стоит у всех выделенных'
        : `Тег добавлен: ${plural(updated, 'запись', 'записи', 'записей')}`,
      updated === 0 ? 'info' : 'success',
    );

  const addById = async (tagId: number) => {
    reportAdded((await actions.assign(ids, { add: [{ tagId, inherit }] })).updated);
  };

  const create = async (plan: CreatePlan) => {
    const { tag } = await actions.createTag(plan);
    await addById(tag.id);
  };

  const remove = async (tag: CatalogTag) => {
    setError(null);
    setPending(true);
    try {
      const { updated } = await actions.assign(ids, { remove: [tag.id] });
      toast(`Тег снят: ${plural(updated, 'запись', 'записи', 'записей')}`, 'success');
    } catch (e) {
      if (!isUnauthorized(e)) setError(errorMessage(e, 'Не удалось снять тег'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Теги выделенных записей"
      className="absolute bottom-full left-1/2 z-50 mb-3 w-80 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-left shadow-2xl"
    >
      <h3 className="mb-2 text-xs font-medium text-zinc-400">
        Теги: {plural(entries.length, 'запись', 'записи', 'записей')}
      </h3>
      <TagCombobox
        label="Добавить тег выделенным"
        placeholder="категория:тег"
        allowCreate
        autoFocus
        onPick={(tag) => addById(tag.id)}
        onCreate={create}
      />
      <label
        className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-400"
        title="Добавляемый тег действует и на все вложения записей, рекурсивно (для фильтра)"
      >
        <input
          type="checkbox"
          checked={inherit}
          onChange={(e) => setInherit(e.target.checked)}
          className="accent-indigo-500"
        />
        Наследуется
      </label>

      <h4 className="mb-1 mt-3 text-xs font-medium text-zinc-400">Есть у выделенных</h4>
      {rows.length > 0 ? (
        <ul aria-label="Теги выделенных" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {rows.map(({ tag, count }) => (
            <li key={tag.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                <TagText category={tag.category} name={tag.name} />
              </span>
              <span className="shrink-0 text-zinc-500" title="У скольких выделенных записей тег стоит напрямую">
                {count} из {entries.length}
              </span>
              <button
                type="button"
                aria-label={`Снять тег «${tagText(tag)}» у выделенных`}
                title="Снять тег у всех выделенных"
                disabled={pending}
                className={chipButtonClass}
                onClick={() => void remove(tag)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-600">Своих тегов у выделенных нет</p>
      )}
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * «Теги…» в панели выделения (UF-16): поповер с полем ввода - добавить тег всем
 * выделенным (с «Наследуется») - и списком тегов выделенных, любой можно снять
 * у всех. Закрывается Esc и кликом мимо.
 */
export function BulkTagsButton({ entries, className }: { entries: Entry[]; className: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Добавить или снять теги у выделенных"
        onClick={() => setOpen((o) => !o)}
      >
        Теги…
      </button>
      {open && <BulkTagsPopover entries={entries} />}
    </div>
  );
}
