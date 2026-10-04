import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError, errorMessage, isUnauthorized } from '../api/client';
import { tagsQuery } from '../api/queries';
import { useEscape } from '../hooks/useDismiss';
import { useTagActions } from '../hooks/useTagActions';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { plural } from '../lib/format';
import { validateTagName } from '../lib/rules';
import { findTag, tagText } from '../lib/tags';
import type { CatalogCategory, CatalogTag } from '../lib/tags';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import { useToast } from './Toasts';

// categoryEn/tagEn - второе (английское) имя; move - выбор другой категории для тега
type Editing = { kind: 'category' | 'categoryEn' | 'tag' | 'tagEn' | 'move'; id: number };

const iconButton =
  'rounded px-1.5 py-0.5 text-sm text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40';

const EN_PLACEHOLDER = 'EN — не задано';

const inputClass =
  'min-w-0 flex-1 rounded-lg border bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none transition placeholder-zinc-600 focus:border-accent';

/**
 * Имя, правимое на месте: Enter или ✓ сохраняет, Esc или ✕ отменяет. Отказ
 * сервера остаётся под полем вместе с введённым текстом. onSubmit может
 * завершиться без ошибки и без правки (например, предложением слить теги) -
 * поле закроется в любом случае. Неизменённое значение ничего не отправляет.
 * allowEmpty - необязательное имя (второе, английское): пустое значение стирает его.
 */
function InlineName({
  label,
  value,
  what,
  placeholder,
  allowEmpty = false,
  onSubmit,
  onDone,
}: {
  label: string;
  value: string;
  what: 'тега' | 'категории';
  placeholder?: string;
  allowEmpty?: boolean;
  onSubmit: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = text.trim();
    if (name === value) {
      onDone();
      return;
    }
    const invalid = allowEmpty && name === '' ? null : validateTagName(name, what);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name);
      onDone();
    } catch (e) {
      if (isUnauthorized(e)) return;
      setError(errorMessage(e, 'Не удалось переименовать'));
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc отменяет правку, а не закрывает экран
      onDone();
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          aria-label={label}
          aria-invalid={error !== null}
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          className={`${inputClass} ${error !== null ? 'border-red-500' : 'border-zinc-700'}`}
        />
        <button type="button" aria-label="Сохранить" title="Сохранить (Enter)" disabled={busy} className={iconButton} onClick={() => void submit()}>
          ✓
        </button>
        <button type="button" aria-label="Отменить" title="Отменить (Esc)" className={iconButton} onClick={onDone}>
          ✕
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Второе (английское) имя тега или категории рядом с основным: клик открывает правку
 * на месте. Пусто - «не задано»: тогда на английском показывается основное имя.
 */
function EnName({ value, label, onEdit }: { value: string; label: string; onEdit: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Английское название: нажмите, чтобы изменить"
      className="min-w-0 max-w-[40%] truncate rounded border border-dashed border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
      onClick={onEdit}
    >
      {value === '' ? <span className="text-zinc-600">{EN_PLACEHOLDER}</span> : value}
    </button>
  );
}

function NewCategoryForm() {
  const actions = useTagActions();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validateTagName(name, 'категории');
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await actions.createCategory(name.trim());
      setName('');
      setError(null);
    } catch (err) {
      if (!isUnauthorized(err)) setError(errorMessage(err, 'Не удалось создать категорию'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mb-5">
      <div className="flex gap-2">
        <input
          aria-label="Название новой категории"
          placeholder="Новая категория"
          spellCheck={false}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className={`${inputClass} py-1.5 ${error !== null ? 'border-red-500' : 'border-zinc-700'}`}
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          Создать категорию
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Экран «Теги» (UF-17): категории и их теги со счётчиками записей. Создать и
 * переименовать категорию, переименовать, перенести в другую категорию, слить и
 * удалить тег; удаление - с подтверждением и числом затронутых записей.
 * Переименование в занятое имя (409) предлагает слить теги. Клик по тегу открывает
 * фильтр по нему. Панель поверх галереи, «Назад» или Esc возвращают к ней.
 * У тега и категории два имени: основное и английское (пунктирная плашка рядом,
 * «не задано» - пусто). Правятся они независимо, и уходит только изменённое поле.
 */
export function TagsScreen({ onBack, onFilter }: { onBack: () => void; onFilter: (tagId: number) => void }) {
  const query = useQuery(tagsQuery);
  const catalog = useTagCatalog();
  const actions = useTagActions();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscape(onBack, confirm === null);

  const stopEditing = () => setEditing(null);

  // ошибка операции без своего поля (перенос, слияние, удаление) - под заголовком
  const fail = (e: unknown, fallback: string) => {
    if (!isUnauthorized(e)) setError(errorMessage(e, fallback));
  };

  const merge = async (from: CatalogTag, into: CatalogTag) => {
    setError(null);
    try {
      const r = await actions.mergeTag(from.id, into.id);
      toast(`Теги слиты: ${plural(r.affectedEntries, 'запись затронута', 'записи затронуто', 'записей затронуто')}`, 'success');
    } catch (e) {
      fail(e, 'Не удалось слить теги');
    }
  };

  const offerMerge = (from: CatalogTag, into: CatalogTag) =>
    setConfirm({
      title: 'Слить с существующим тегом?',
      message:
        `Тег «${into.label}» уже есть в категории «${into.categoryLabel}». Слить «${from.label}» с ним? ` +
        `Все присвоения «${from.label}» (записей: ${from.count}) перейдут на «${into.label}», а сам «${from.label}» будет удалён.`,
      confirmLabel: 'Слить',
      danger: true,
      onConfirm: () => void merge(from, into),
    });

  // 409: имя занято тегом той же (или целевой) категории, причём совпасть могло с любым
  // из двух его имён - предлагаем слить с ним. names - имена, из-за которых мог быть отказ
  const onConflict = (e: unknown, from: CatalogTag, categoryId: number, ...names: string[]): boolean => {
    if (!(e instanceof ApiRequestError) || e.status !== 409) return false;
    const existing = names
      .filter((name) => name !== '')
      .map((name) => findTag(catalog, categoryId, name))
      .find((tag) => tag !== undefined && tag.id !== from.id);
    if (existing === undefined) return false;
    offerMerge(from, existing);
    return true;
  };

  const renameTag = async (tag: CatalogTag, name: string) => {
    try {
      await actions.renameTag(tag.id, name);
    } catch (e) {
      if (!onConflict(e, tag, tag.categoryId, name)) throw e;
    }
  };

  // второе имя: PATCH только с nameEn; пустое стирает его
  const setTagNameEn = async (tag: CatalogTag, nameEn: string) => {
    try {
      await actions.setTagNameEn(tag.id, nameEn);
    } catch (e) {
      if (!onConflict(e, tag, tag.categoryId, nameEn)) throw e;
    }
  };

  const moveTag = async (tag: CatalogTag, categoryId: number) => {
    setError(null);
    try {
      await actions.moveTag(tag.id, categoryId);
    } catch (e) {
      if (!onConflict(e, tag, categoryId, tag.name, tag.nameEn)) fail(e, 'Не удалось перенести тег');
    }
  };

  const removeTag = (tag: CatalogTag) =>
    setConfirm({
      title: `Удалить тег «${tagText(tag)}»?`,
      message:
        tag.count === 0
          ? 'Тег не назначен ни одной записи. Восстановить его нельзя.'
          : `Тег будет снят с записей: ${tag.count}. Восстановить его нельзя.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () =>
        void (async () => {
          setError(null);
          try {
            const r = await actions.removeTag(tag.id);
            toast(`Тег удалён, затронуто записей: ${r.affectedEntries}`, 'success');
          } catch (e) {
            fail(e, 'Не удалось удалить тег');
          }
        })(),
    });

  const removeCategory = (category: CatalogCategory) => {
    const total = category.tags.reduce((sum, t) => sum + t.count, 0);
    setConfirm({
      title: `Удалить категорию «${category.label}»?`,
      message:
        category.tags.length === 0
          ? 'В категории нет тегов. Восстановить её нельзя.'
          : `Будут удалены все её теги (${category.tags.length}) и сняты с записей (не более ${total}). Восстановить их нельзя.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () =>
        void (async () => {
          setError(null);
          try {
            const r = await actions.removeCategory(category.id);
            toast(`Категория удалена: тегов ${r.removedTags}, затронуто записей ${r.affectedEntries}`, 'success');
          } catch (e) {
            fail(e, 'Не удалось удалить категорию');
          }
        })(),
    });
  };

  return (
    <div
      role="region"
      aria-label="Управление тегами"
      className="fixed inset-x-0 bottom-8 top-14 z-30 flex flex-col bg-zinc-950"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <button
          type="button"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500"
          title="Назад к галерее (Esc)"
          onClick={onBack}
        >
          ← Назад
        </button>
        <h2 className="text-base font-medium text-zinc-100">Теги</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          <NewCategoryForm />
          {error !== null && (
            <p role="alert" className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          {!catalog.ready ? (
            query.isError ? (
              <div className="flex flex-col items-start gap-2 text-sm text-zinc-300">
                <p>{query.error.message}</p>
                <button
                  type="button"
                  className="rounded-lg bg-accent px-3 py-1.5 text-white hover:bg-accent-hover"
                  onClick={() => void query.refetch()}
                >
                  Повторить
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-500" aria-busy="true">
                Загрузка…
              </p>
            )
          ) : catalog.categories.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Категорий пока нет. Создайте первую выше - теги появятся в ней, когда вы добавите их записям.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {catalog.categories.map((category) => (
                <section
                  key={category.id}
                  aria-label={`Категория ${category.name}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50"
                >
                  <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                    {editing?.kind === 'category' && editing.id === category.id ? (
                      <InlineName
                        label="Новое имя категории"
                        value={category.name}
                        what="категории"
                        onSubmit={async (name) => void (await actions.renameCategory(category.id, name))}
                        onDone={stopEditing}
                      />
                    ) : editing?.kind === 'categoryEn' && editing.id === category.id ? (
                      <InlineName
                        label="Английское имя категории"
                        value={category.nameEn}
                        what="категории"
                        placeholder={EN_PLACEHOLDER}
                        allowEmpty
                        onSubmit={async (nameEn) => void (await actions.setCategoryNameEn(category.id, nameEn))}
                        onDone={stopEditing}
                      />
                    ) : (
                      <>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100" title={category.name}>
                          {category.name}
                          <span className="ml-2 text-xs font-normal text-zinc-500">
                            {plural(category.tags.length, 'тег', 'тега', 'тегов')}
                          </span>
                        </h3>
                        <EnName
                          value={category.nameEn}
                          label={`Английское имя категории «${category.name}»`}
                          onEdit={() => setEditing({ kind: 'categoryEn', id: category.id })}
                        />
                        <button
                          type="button"
                          aria-label={`Переименовать категорию «${category.name}»`}
                          title="Переименовать"
                          className={iconButton}
                          onClick={() => setEditing({ kind: 'category', id: category.id })}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          aria-label={`Удалить категорию «${category.name}»`}
                          title="Удалить категорию"
                          className={`${iconButton} hover:text-red-300`}
                          onClick={() => removeCategory(category)}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </header>

                  {category.tags.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-600">В категории пока нет тегов</p>
                  ) : (
                    <ul>
                      {category.tags.map((tag) => (
                        <li key={tag.id} className="flex items-center gap-2 px-3 py-1.5">
                          {editing?.kind === 'tag' && editing.id === tag.id ? (
                            <InlineName
                              label="Новое имя тега"
                              value={tag.name}
                              what="тега"
                              onSubmit={(name) => renameTag(tag, name)}
                              onDone={stopEditing}
                            />
                          ) : editing?.kind === 'tagEn' && editing.id === tag.id ? (
                            <InlineName
                              label="Английское имя тега"
                              value={tag.nameEn}
                              what="тега"
                              placeholder={EN_PLACEHOLDER}
                              allowEmpty
                              onSubmit={(nameEn) => setTagNameEn(tag, nameEn)}
                              onDone={stopEditing}
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200 transition hover:text-accent-hover"
                                title="Показать записи с этим тегом"
                                aria-label={`Показать записи с тегом «${tagText(tag)}»`}
                                onClick={() => onFilter(tag.id)}
                              >
                                {tag.name}
                              </button>
                              <EnName
                                value={tag.nameEn}
                                label={`Английское имя тега «${tag.name}»`}
                                onEdit={() => setEditing({ kind: 'tagEn', id: tag.id })}
                              />
                              <span
                                className="shrink-0 text-xs tabular-nums text-zinc-500"
                                title="Записей с этим тегом"
                              >
                                {tag.count}
                              </span>
                              {editing?.kind === 'move' && editing.id === tag.id ? (
                                <select
                                  autoFocus
                                  aria-label={`Перенести тег «${tag.name}» в категорию`}
                                  defaultValue=""
                                  className="max-w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-200"
                                  onChange={(e) => {
                                    stopEditing();
                                    void moveTag(tag, Number(e.target.value));
                                  }}
                                  onBlur={stopEditing}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Escape') return;
                                    e.stopPropagation();
                                    stopEditing();
                                  }}
                                >
                                  <option value="" disabled>
                                    Выберите категорию…
                                  </option>
                                  {catalog.categories
                                    .filter((c) => c.id !== tag.categoryId)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.label}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Перенести тег «${tag.name}» в другую категорию`}
                                  title="Перенести в другую категорию"
                                  disabled={catalog.categories.length < 2}
                                  className={iconButton}
                                  onClick={() => setEditing({ kind: 'move', id: tag.id })}
                                >
                                  ⇄
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Переименовать тег «${tag.name}»`}
                                title="Переименовать"
                                className={iconButton}
                                onClick={() => setEditing({ kind: 'tag', id: tag.id })}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                aria-label={`Удалить тег «${tag.name}»`}
                                title="Удалить тег"
                                className={`${iconButton} hover:text-red-300`}
                                onClick={() => removeTag(tag)}
                              >
                                🗑
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
