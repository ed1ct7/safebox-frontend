import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, isUnauthorized } from '../api/client';
import { entryQuery } from '../api/queries';
import type { Entry } from '../api/types';
import { useEvent } from '../hooks/useEvent';
import { useTagActions } from '../hooks/useTagActions';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { displayName } from '../lib/link';
import type { ResolvedCreatePlan } from '../lib/tagInput';
import { groupEntryTags, tagText } from '../lib/tags';
import type { CatalogTag, EntryTag } from '../lib/tags';
import { chipButtonClass, chipClass, TagText } from './TagChip';
import { TagCombobox } from './TagCombobox';

/**
 * Унаследованный тег: бледный, без крестика (снимается только у записи-источника),
 * в подсказке - от кого. Имя источника берём из уже известных крошек, а если его
 * там нет (результаты поиска) - запросом GET /entries/:id. Клик ведёт к источнику.
 */
function InheritedChip({
  tag,
  knownName,
  onOpenSource,
}: {
  tag: EntryTag;
  knownName: string | undefined;
  onOpenSource: (id: number) => void;
}) {
  const fromId = tag.fromId ?? 0;
  const source = useQuery({ ...entryQuery(fromId), enabled: knownName === undefined });
  const name = knownName ?? (source.data !== undefined ? displayName(source.data) : '…');
  return (
    <button
      type="button"
      title={`от: ${name}`}
      className={`${chipClass(true)} cursor-pointer transition hover:opacity-100`}
      onClick={() => onOpenSource(fromId)}
    >
      <span className="min-w-0 truncate">
        <TagText category={tag.category} name={tag.name} />
      </span>
    </button>
  );
}

/**
 * Секция «Теги» панели свойств (UF-16, UF-22): теги записи по категориям, поле
 * добавления и переключатель «Наследуется». Прямой тег снимается крестиком, его
 * наследование переключается кнопкой ↳ (повторное присвоение с другим inherit).
 * Клик по имени прямого тега (onFilterTag) - фильтр по нему на весь сейф.
 * focusRequested - открыли из меню «Теги…»: фокус в поле ввода.
 */
export function TagsSection({
  entry,
  sourceNames,
  onOpenSource,
  onFilterTag,
  focusRequested = false,
  onFocused,
}: {
  entry: Entry;
  sourceNames: ReadonlyMap<number, string>;
  onOpenSource: (id: number) => void;
  /** клик по тегу записи - фильтр по нему (панель фильтра открывает MainShell) */
  onFilterTag?: (tagId: number) => void;
  focusRequested?: boolean;
  onFocused?: () => void;
}) {
  const catalog = useTagCatalog();
  const actions = useTagActions();
  const [inherit, setInherit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useEvent(() => onFocused?.());

  const groups = useMemo(() => groupEntryTags(entry, catalog), [entry, catalog]);
  const assigned = useMemo(() => new Set(entry.tags.map((t) => t.tagId)), [entry.tags]);
  const hasTags = entry.tags.length > 0 || entry.inheritedTags.length > 0;

  useEffect(() => {
    if (!focusRequested) return;
    inputRef.current?.focus();
    focused();
  }, [focusRequested, focused]);

  // правки чипов: ошибка сервера - под секцией, запись при этом не меняется
  const change = async (job: () => Promise<unknown>) => {
    setError(null);
    setPending(true);
    try {
      await job();
    } catch (e) {
      if (!isUnauthorized(e)) setError(errorMessage(e, 'Не удалось изменить теги'));
    } finally {
      setPending(false);
    }
  };

  const add = (tag: CatalogTag) =>
    actions.assign([entry.id], { add: [{ tagId: tag.id, inherit }] }).then(() => undefined);

  const create = async (plan: ResolvedCreatePlan) => {
    const { tag } = await actions.createTag(plan);
    await actions.assign([entry.id], { add: [{ tagId: tag.id, inherit }] });
  };

  return (
    <section aria-label="Теги">
      <h4 className="mb-1.5 text-xs font-medium text-zinc-400">Теги</h4>

      {groups.length > 0 ? (
        <div className="mb-2.5 flex flex-col gap-1.5">
          {groups.map((g) => (
            <div key={g.categoryId} className="flex flex-wrap gap-1.5">
              {g.direct.map((t) => (
                <span key={t.tagId} className={chipClass()}>
                  {onFilterTag !== undefined ? (
                    <button
                      type="button"
                      className="min-w-0 cursor-pointer truncate text-left transition hover:text-white hover:underline hover:underline-offset-2"
                      title={`Показать все записи с тегом «${tagText(t)}»`}
                      onClick={() => onFilterTag(t.tagId)}
                    >
                      <TagText category={t.category} name={t.name} />
                    </button>
                  ) : (
                    <span className="min-w-0 truncate">
                      <TagText category={t.category} name={t.name} />
                    </span>
                  )}
                  <button
                    type="button"
                    aria-pressed={t.inherit}
                    aria-label={`Наследуется: ${tagText(t)}`}
                    title={
                      t.inherit
                        ? 'Наследуется: действует и на все вложения записи (нажмите, чтобы отключить)'
                        : 'Не наследуется (нажмите, чтобы тег действовал и на все вложения записи)'
                    }
                    disabled={pending}
                    className={`${chipButtonClass} ${t.inherit ? 'bg-accent/30 text-zinc-100' : ''}`}
                    onClick={() =>
                      void change(() => actions.assign([entry.id], { add: [{ tagId: t.tagId, inherit: !t.inherit }] }))
                    }
                  >
                    ↳
                  </button>
                  <button
                    type="button"
                    aria-label={`Снять тег «${tagText(t)}»`}
                    title="Снять тег"
                    disabled={pending}
                    className={chipButtonClass}
                    onClick={() => void change(() => actions.assign([entry.id], { remove: [t.tagId] }))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {g.inherited.map((t) => (
                <InheritedChip
                  key={`from-${t.tagId}`}
                  tag={t}
                  knownName={t.fromId === null ? undefined : sourceNames.get(t.fromId)}
                  onOpenSource={onOpenSource}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-2.5 text-xs text-zinc-600">
          {hasTags && !catalog.ready ? 'Загрузка…' : 'Тегов пока нет'}
        </p>
      )}

      <TagCombobox
        label="Добавить тег"
        placeholder="тег"
        allowCreate
        exclude={assigned}
        inputRef={inputRef}
        onPick={add}
        onCreate={create}
      />
      <label
        className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-400"
        title="Добавляемый тег действует и на все вложения записи, рекурсивно (для фильтра)"
      >
        <input
          type="checkbox"
          checked={inherit}
          onChange={(e) => setInherit(e.target.checked)}
          className="accent-indigo-500"
        />
        Наследуется
      </label>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
