import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { errorMessage } from '../api/client';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { foldForSearch } from '../lib/fold';
import { completionText, suggestTags } from '../lib/tagInput';
import type { CreatePlan, ResolvedCreatePlan } from '../lib/tagInput';
import { validateTagName } from '../lib/rules';
import { findCategory } from '../lib/tags';
import type { CatalogTag, TagCatalog } from '../lib/tags';
import { TagText } from './TagChip';

type Option = { kind: 'tag'; tag: CatalogTag } | { kind: 'create'; plan: CreatePlan };

function createLabel(plan: CreatePlan, catalog: TagCatalog): string {
  if (plan.category === null) return `Создать тег ${plan.name}…`;
  if (plan.newCategory) return `Создать категорию ${plan.category} и тег ${plan.name}`;
  // существующая категория подписана на языке тегов (в плане - её основное имя)
  const category = findCategory(catalog, plan.category)?.label ?? plan.category;
  return `Создать тег ${plan.name} в категории ${category}`;
}

export interface TagComboboxProps {
  label: string;
  placeholder?: string;
  /** false - фильтр: выбирать можно только существующие теги */
  allowCreate: boolean;
  /** уже выбранные теги: не предлагаем */
  exclude?: ReadonlySet<number>;
  /** список поверх соседей (поповеры); иначе - в потоке (панель свойств) */
  floating?: boolean;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
  onPick: (tag: CatalogTag) => Promise<void>;
  /** создать тег (и категорию, если plan.newCategory); после успеха поле очищается */
  onCreate?: (plan: ResolvedCreatePlan) => Promise<void>;
}

/**
 * Поле ввода тега с автодополнением (UF-16, UF-18): «тег» или просто текст.
 * Подсказки видны сразу - по фокусу в пустом поле открывается весь
 * каталог (по категориям, со счётчиками), кнопка ▾ открывает и закрывает его
 * вручную. Как обычный комбобокс: стрелки выбирают, Enter подтверждает, Esc
 * закрывает список (потом очищает поле), Tab подставляет вариант в поле.
 * Создание - как в менеджерах тегов: ввели имя, Enter по «Создать тег…», и в панели
 * под полем категорию выбирают кликом по существующей или вписывают новую.
 * «категория:тег» тоже работает (категория тогда уже указана, панель не нужна).
 * Отказ сервера (422…) показывается под полем.
 */
export function TagCombobox({
  label,
  placeholder,
  allowCreate,
  exclude,
  floating = false,
  autoFocus = false,
  inputRef,
  onPick,
  onCreate,
}: TagComboboxProps) {
  const catalog = useTagCatalog();
  const listId = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // панель создания: имя тега + выбранная категория (чип или своя строка)
  const [pick, setPick] = useState<{ name: string; newCategory: string } | null>(null);
  const [pickedCat, setPickedCat] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const suggestions = useMemo(
    () => suggestTags(catalog, text, { allowCreate, exclude }),
    [catalog, text, allowCreate, exclude],
  );
  const options = useMemo<Option[]>(() => {
    const list: Option[] = suggestions.tags.map((tag) => ({ kind: 'tag', tag }));
    if (suggestions.create !== null) list.push({ kind: 'create', plan: suggestions.create });
    return list;
  }, [suggestions]);

  const message = suggestions.error ?? suggestions.hint;
  const showList = open && pick === null && (options.length > 0 || (message !== null && text.trim() !== ''));

  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const closePick = () => {
    setPick(null);
    setPickedCat(null);
    setPickError(null);
  };

  const run = async (job: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await job();
      setText('');
      setOpen(false);
      setActive(-1);
      closePick();
      // панель исчезла вместе с фокусом: возвращаем его в поле для следующего тега
      const focus = document.activeElement;
      if (focus === null || focus === document.body || wrapRef.current?.contains(focus) === true) {
        input.current?.focus();
      }
    } catch (e) {
      closePick();
      setError(errorMessage(e, 'Не удалось добавить тег'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const create = (plan: ResolvedCreatePlan) => {
    if (onCreate !== undefined) void run(() => onCreate(plan));
  };

  const choose = (option: Option) => {
    if (option.kind === 'tag') {
      void run(() => onPick(option.tag));
      return;
    }
    const { plan } = option;
    if (plan.category !== null && !plan.newCategory) {
      create(plan); // «категория:тег» - категория уже есть, панель не нужна
      return;
    }
    // категорию выбирают в панели: пустая строка «новая» при голом имени,
    // с «:» - подсвечена введённая (несуществующая) категория
    setPick({ name: plan.name, newCategory: plan.category ?? '' });
    setOpen(false);
  };

  const move = (delta: 1 | -1) => {
    const n = options.length;
    if (n === 0) return;
    setActive((a) => (a < 0 ? (delta > 0 ? 0 : n - 1) : (a + delta + n) % n));
  };

  /** Создать из панели: чип - существующая категория, строка - новая (с проверкой). */
  const submitCreate = () => {
    if (pick === null) return;
    const typed = pick.newCategory.trim();
    if (typed !== '') {
      const problem = validateTagName(typed, 'категории');
      if (problem !== null) {
        setPickError(problem);
        return;
      }
      create({ category: typed, name: pick.name, newCategory: true });
    } else if (pickedCat !== null) {
      create({ category: pickedCat, name: pick.name, newCategory: false });
    }
  };

  const onEnter = () => {
    const highlighted = showList && active >= 0 ? options[active] : undefined;
    const first = suggestions.tags[0];
    const option: Option | undefined =
      highlighted ??
      (suggestions.exact !== null ? { kind: 'tag', tag: suggestions.exact } : undefined) ??
      (suggestions.create !== null ? { kind: 'create', plan: suggestions.create } : undefined) ??
      // создавать нечего (фильтр или неполный ввод) - берём первый вариант, как в обычном автодополнении
      (showList && first !== undefined ? { kind: 'tag', tag: first } : undefined);
    if (option !== undefined) choose(option);
    else if (suggestions.error !== null && text.trim() !== '') setError(suggestions.error);
  };

  /** Tab подставляет вариант в поле; нечего подставлять - фокус уходит как обычно. */
  const onTab = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.shiftKey || text.trim() === '' || !showList) return;
    const picked = active >= 0 ? options[active] : undefined;
    const tag = picked !== undefined ? (picked.kind === 'tag' ? picked.tag : undefined) : suggestions.tags[0];
    if (tag === undefined) return;
    const typed = foldForSearch(text.trim().replace(/\s*:\s*/, ':'));
    if (typed === foldForSearch(completionText(tag))) return;
    e.preventDefault();
    setText(completionText(tag));
    setActive(-1);
    setError(null);
  };

  const onEscape = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open || text !== '' || error !== null) {
      // сначала закрываем список, потом очищаем поле; окно и панель Esc не видят
      e.preventDefault();
      e.stopPropagation();
      if (open) setOpen(false);
      else {
        setText('');
        setError(null);
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        move(e.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        onEnter();
        break;
      case 'Tab':
        onTab(e);
        break;
      case 'Escape':
        onEscape(e);
        break;
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div className="relative">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error !== null}
          aria-busy={pending}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          title="↑↓ - выбор, Enter - добавить, Tab - подставить вариант, Esc - закрыть"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          closePick();
          setError(null);
        }}
          onFocus={() => {
            // подсказки видны сразу: фокус в пустом поле открывает весь каталог
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-lg border bg-zinc-950 py-1.5 pl-2.5 pr-7 text-sm text-zinc-100 outline-none transition placeholder-zinc-600 focus:border-accent ${
            error !== null ? 'border-red-500' : 'border-zinc-700'
          }`}
        />
        <button
          type="button"
          aria-label="Показать существующие теги"
          aria-expanded={showList}
          title="Показать существующие теги"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-zinc-500 transition hover:text-zinc-200"
          onMouseDown={(e) => e.preventDefault()} // клик не уводит фокус из поля
          onClick={() => {
            setOpen((o) => !o);
            input.current?.focus();
          }}
        >
          {showList ? '▴' : '▾'}
        </button>
      </div>

      {showList && (
        <div
          className={`overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 ${
            floating ? 'absolute inset-x-0 top-full z-50 mt-1 shadow-2xl' : 'mt-1'
          }`}
          onMouseDown={(e) => e.preventDefault()} // клик по строке не уводит фокус из поля
        >
          {options.length > 0 && (
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto py-1">
              {options.map((option, i) => (
                <li
                  key={option.kind === 'tag' ? option.tag.id : 'create'}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-sm ${
                    option.kind === 'create' ? 'text-accent-hover' : 'text-zinc-200'
                  } ${i === active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option)}
                >
                  {option.kind === 'tag' ? (
                    <>
                      <span className="min-w-0 truncate">
                        <TagText tag={option.tag} />
                      </span>
                      <span className="shrink-0 text-xs text-zinc-600" title="Записей с этим тегом">
                        {option.tag.count}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 break-words">{createLabel(option.plan, catalog)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {message !== null && text.trim() !== '' && (
            <p className={`px-2.5 py-1.5 text-xs ${suggestions.error !== null ? 'text-red-300' : 'text-zinc-500'}`}>
              {message}
            </p>
          )}
          {allowCreate && text.trim() === '' && suggestions.tags.length > 0 && (
            <p className="border-t border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-600">
              Новый тег — введите имя
            </p>
          )}
        </div>
      )}

      {pick !== null && (
        <div
          role="group"
          aria-label="Категория нового тега"
          className="mt-1 rounded-lg border border-amber-800/70 bg-amber-950/40 p-2.5 text-xs text-amber-100"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            closePick();
            input.current?.focus();
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p>
              Новый тег: <b>{pick.name}</b>
            </p>
            <button
              type="button"
              aria-label="Не создавать"
              title="Не создавать (Esc)"
              className="rounded px-1.5 py-0.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => {
                closePick();
                input.current?.focus();
              }}
            >
              ✕
            </button>
          </div>

          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200/70">
            Категория
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {catalog.categories.map((c) => {
              const on = pickedCat === c.name && pick.newCategory.trim() === '';
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  title={`Положить тег в категорию «${c.label}» (${c.tags.length} тегов)`}
                  className={`max-w-full truncate rounded-full border px-2.5 py-1 transition ${
                    on
                      ? 'border-accent bg-accent/30 text-zinc-100'
                      : 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:border-zinc-400'
                  }`}
                  onClick={() => {
                    setPickedCat(c.name);
                    setPick((p) => (p === null ? p : { ...p, newCategory: '' }));
                    setPickError(null);
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          <div className="mb-2 flex items-center gap-2 text-amber-200/60" aria-hidden="true">
            <span className="h-px flex-1 bg-amber-800/50" />
            <span>или</span>
            <span className="h-px flex-1 bg-amber-800/50" />
          </div>
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-amber-200/80">Новая категория:</span>
            <input
              aria-label="Новая категория"
              placeholder="имя"
              spellCheck={false}
              value={pick.newCategory}
              autoFocus
              onChange={(e) => {
                setPick((p) => (p === null ? p : { ...p, newCategory: e.target.value }));
                setPickedCat(null);
                setPickError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                submitCreate();
              }}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none transition placeholder-zinc-600 focus:border-accent"
            />
          </label>
          {pickError !== null && <p role="alert" className="mt-1 text-red-300">{pickError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-zinc-400 transition hover:text-zinc-200"
              onClick={() => {
                closePick();
                input.current?.focus();
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={pending || (pickedCat === null && pick.newCategory.trim() === '')}
              className="rounded bg-accent px-3 py-1 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              onClick={submitCreate}
            >
              Создать тег «{pick.name}»
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
