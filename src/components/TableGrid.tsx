import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, MutableRefObject } from 'react';
import { useDismiss } from '../hooks/useDismiss';
import { useEvent } from '../hooks/useEvent';
import { isInteractiveTarget, isTypingTarget } from '../lib/dom';
import {
  addColumn,
  addRow,
  cellOf,
  COLUMN_TYPES,
  deleteColumn,
  deleteRows,
  freeColumnName,
  generatePassword,
  moveColumn,
  parseDelimited,
  pasteBlock,
  setCell,
  updateColumn,
} from '../lib/table';
import type { ColumnType, TableColumn, TableDoc, TableRow, TableSort } from '../lib/table';

/** Строка-заготовка под таблицей: ввод в неё создаёт настоящую строку. */
const NEW_ROW = '+';
const HIDDEN = '••••••••'; // длина не зависит от значения: по точкам пароль не оценить

interface Pos {
  row: string; // id строки или NEW_ROW
  col: string;
}

/** initial: null - править текущее значение, строка - начать с неё (первая нажатая клавиша). */
type Editing = Pos & { initial: string | null };

type Move = 'none' | 'down' | 'right' | 'left';

export interface TableGridHandle {
  /** Курсор в первую ячейку строки-заготовки и сразу ввод («+ Строка»). */
  startNewRow: () => void;
  focus: () => void;
}

const TYPE_ICON: Record<ColumnType, string> = { text: '', secret: '🔒', url: '🔗' };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const cellButton =
  'flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100';

// ── Редактор ячейки ─────────────────────────────────────────────────────────

/**
 * Enter - записать и вниз, Tab / Shift+Tab - записать и вправо / влево, Esc - отмена,
 * Shift+Enter и Alt+Enter - перенос строки, уход фокуса - записать. Секрет в редакторе
 * виден: его набирают глазами. Нажатия наружу не уходят (сетка и окно их не видят).
 */
function CellEditor({
  column,
  value,
  initial,
  onCommit,
  onCancel,
}: {
  column: TableColumn;
  value: string;
  initial: string | null;
  onCommit: (value: string, move: Move) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial ?? value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(text, move);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      onCancel();
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const at = el.selectionStart;
      setText(`${text.slice(0, at)}\n${text.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1));
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(e.shiftKey ? 'left' : 'right');
    }
  };

  return (
    <div className="flex items-start gap-1">
      <textarea
        ref={ref}
        value={text}
        rows={clamp(text.split('\n').length, 1, 8)}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${column.name}: значение`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => e.stopPropagation()}
        onBlur={() => finish('none')}
        className={`block w-full min-w-[9rem] resize-none rounded border border-accent bg-zinc-950 px-1.5 py-0.5 text-sm text-zinc-100 outline-none ${
          column.type === 'secret' ? 'font-mono' : ''
        }`}
      />
      {column.type === 'secret' && (
        <button
          type="button"
          tabIndex={-1}
          title="Сгенерировать пароль: 20 знаков, буквы, цифры и символы"
          aria-label="Сгенерировать пароль"
          className={`${cellButton} shrink-0 border border-zinc-700`}
          onMouseDown={(e) => e.preventDefault()} // фокус остаётся в поле: уход фокуса записал бы ячейку
          onClick={() => setText(generatePassword())}
        >
          🎲
        </button>
      )}
    </div>
  );
}

// ── Строка ──────────────────────────────────────────────────────────────────

interface RowHandlers {
  onSelect: (pos: Pos) => void;
  onStartEdit: (pos: Pos) => void;
  onCommit: (value: string, move: Move) => void;
  onCancel: () => void;
  onToggleReveal: (pos: Pos) => void;
  onCopy: (pos: Pos) => void;
  onOpen: (pos: Pos) => void;
  onDeleteRow: (rowId: string) => void;
}

/** memo: движение курсора перерисовывает две строки, а не всю таблицу. */
const GridRow = memo(function GridRow({
  row,
  number,
  columns,
  activeCol,
  editing,
  revealAll,
  revealed,
  handlers,
}: {
  row: TableRow | null; // null - строка-заготовка
  number: number;
  columns: readonly TableColumn[];
  activeCol: string | null;
  editing: { col: string; initial: string | null } | null;
  revealAll: boolean;
  /** id открытых секретных столбцов этой строки через запятую (строка - чтобы memo сравнивал значение) */
  revealed: string;
  handlers: RowHandlers;
}) {
  const rowId = row?.id ?? NEW_ROW;
  const shown = revealed === '' ? [] : revealed.split(',');
  return (
    <tr className="group/row">
      <td className="sticky left-0 z-[1] w-10 border-b border-r border-zinc-800 bg-zinc-950 text-center align-top text-xs text-zinc-600">
        {row === null ? (
          <span className="block py-2" title="Новая строка: начните печатать">
            +
          </span>
        ) : (
          <>
            <span className="block py-2 group-hover/row:hidden">{number}</span>
            <button
              type="button"
              tabIndex={-1}
              title="Удалить строку (вернуть: Ctrl+Z)"
              aria-label={`Удалить строку ${number}`}
              className="hidden h-full w-full py-2 text-zinc-500 hover:text-red-300 group-hover/row:block"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlers.onDeleteRow(row.id)}
            >
              ✕
            </button>
          </>
        )}
      </td>
      {columns.map((column) => {
        const pos = { row: rowId, col: column.id };
        const value = cellOf(row ?? undefined, column.id);
        const active = activeCol === column.id;
        const isEditing = editing?.col === column.id;
        const open = column.type !== 'secret' || revealAll || shown.includes(column.id);
        return (
          <td
            key={column.id}
            data-cell={`${rowId}:${column.id}`}
            aria-selected={active}
            className={`group/cell relative scroll-mt-10 border-b border-r border-zinc-800 px-2 py-1.5 align-top ${
              active ? 'bg-accent/10 outline outline-2 -outline-offset-2 outline-accent' : 'hover:bg-zinc-900/70'
            }`}
            onMouseDown={() => handlers.onSelect(pos)}
            onDoubleClick={() => handlers.onStartEdit(pos)}
          >
            {isEditing ? (
              <CellEditor
                column={column}
                value={value}
                initial={editing.initial}
                onCommit={handlers.onCommit}
                onCancel={handlers.onCancel}
              />
            ) : (
              <>
                <div className="min-h-5 min-w-[9rem] max-w-[26rem] cursor-cell select-none">
                  {value === '' ? null : !open ? (
                    <span className="tracking-widest text-zinc-500" aria-label="Скрыто">
                      {HIDDEN}
                    </span>
                  ) : column.type === 'secret' ? (
                    <span className="break-all font-mono text-zinc-100">{value}</span>
                  ) : column.type === 'url' ? (
                    <span className="block truncate text-accent-hover" title={value}>
                      {value}
                    </span>
                  ) : (
                    <span className="line-clamp-3 whitespace-pre-wrap break-words text-zinc-200" title={value}>
                      {value}
                    </span>
                  )}
                </div>
                {value !== '' && (
                  <div
                    className={`absolute right-0.5 top-1 gap-0.5 rounded bg-zinc-900/95 ${
                      active ? 'flex' : 'hidden group-hover/cell:flex'
                    }`}
                    onMouseDown={(e) => e.preventDefault()} // кнопки не забирают фокус у сетки
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {column.type === 'secret' && !revealAll && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={cellButton}
                        title={open ? 'Скрыть' : 'Показать'}
                        aria-label={open ? `Скрыть: ${column.name}` : `Показать: ${column.name}`}
                        onClick={() => handlers.onToggleReveal(pos)}
                      >
                        {open ? '🙈' : '👁'}
                      </button>
                    )}
                    {column.type === 'url' && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={cellButton}
                        title="Открыть в браузере"
                        aria-label={`Открыть: ${column.name}`}
                        onClick={() => handlers.onOpen(pos)}
                      >
                        ↗
                      </button>
                    )}
                    <button
                      type="button"
                      tabIndex={-1}
                      className={cellButton}
                      title="Копировать (Ctrl+C)"
                      aria-label={`Копировать: ${column.name}`}
                      onClick={() => handlers.onCopy(pos)}
                    >
                      ⧉
                    </button>
                  </div>
                )}
              </>
            )}
          </td>
        );
      })}
      <td className="border-b border-zinc-800" />
    </tr>
  );
});

// ── Заголовок столбца ───────────────────────────────────────────────────────

const menuItem = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40';

function ColumnHeader({
  column,
  index,
  count,
  sort,
  renaming,
  onSort,
  onRename,
  onRenameStart,
  onRenameEnd,
  onType,
  onMove,
  onInsert,
  onDelete,
}: {
  column: TableColumn;
  index: number;
  count: number;
  sort: TableSort | null;
  renaming: boolean;
  onSort: () => void;
  onRename: (name: string) => void;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  onType: (type: ColumnType) => void;
  onMove: (delta: -1 | 1) => void;
  onInsert: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const dir = sort?.columnId === column.id ? sort.dir : null;
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <th
      scope="col"
      aria-sort={dir === null ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}
      className="sticky top-0 z-10 border-b border-r border-zinc-700 bg-zinc-900 p-0 text-left font-medium"
    >
      <div ref={ref} className="relative flex items-center">
        {renaming ? (
          <ColumnNameInput initial={column.name} onCommit={onRename} onDone={onRenameEnd} />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-sm text-zinc-200 hover:text-white"
            title="Сортировать по столбцу; двойной клик — переименовать"
            onClick={onSort}
            onDoubleClick={onRenameStart}
          >
            {TYPE_ICON[column.type] !== '' && (
              <span className="text-xs" aria-hidden="true">
                {TYPE_ICON[column.type]}
              </span>
            )}
            <span className="truncate">{column.name === '' ? 'Без названия' : column.name}</span>
            {dir !== null && (
              <span className="text-xs text-accent-hover" aria-hidden="true">
                {dir === 'asc' ? '▲' : '▼'}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Столбец «${column.name}»: действия`}
          className="shrink-0 px-1.5 py-2 text-xs text-zinc-500 hover:text-zinc-200"
          onClick={() => setOpen((o) => !o)}
        >
          ▾
        </button>
        {open && (
          <div
            role="menu"
            className={`absolute top-full z-30 mt-0.5 w-60 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 font-normal shadow-2xl ${
              index > 0 && index === count - 1 ? 'right-0' : 'left-0'
            }`}
          >
            <button type="button" role="menuitem" className={menuItem} onClick={() => pick(onRenameStart)}>
              Переименовать
            </button>
            <p className="border-t border-zinc-800 px-3 pb-0.5 pt-1.5 text-[11px] uppercase tracking-wider text-zinc-600">
              Тип
            </p>
            {COLUMN_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="menuitemradio"
                aria-checked={column.type === t.type}
                title={t.hint}
                className={menuItem}
                onClick={() => pick(() => onType(t.type))}
              >
                <span className="w-4 text-accent-hover">{column.type === t.type ? '✓' : ''}</span>
                {t.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className={`${menuItem} border-t border-zinc-800`}
              disabled={index === 0}
              onClick={() => pick(() => onMove(-1))}
            >
              ← Сдвинуть влево
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={index === count - 1}
              onClick={() => pick(() => onMove(1))}
            >
              Сдвинуть вправо →
            </button>
            <button type="button" role="menuitem" className={menuItem} onClick={() => pick(onInsert)}>
              Вставить столбец справа
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${menuItem} border-t border-zinc-800 text-red-300`}
              disabled={count === 1}
              title={count === 1 ? 'В таблице должен остаться хотя бы один столбец' : undefined}
              onClick={() => pick(onDelete)}
            >
              Удалить столбец
            </button>
          </div>
        )}
      </div>
    </th>
  );
}

function ColumnNameInput({
  initial,
  onCommit,
  onDone,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.select(), []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (commit && name !== '') onCommit(name);
    onDone();
  };
  return (
    <input
      ref={ref}
      value={value}
      spellCheck={false}
      maxLength={80}
      aria-label="Название столбца"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="m-1 min-w-[8rem] flex-1 rounded border border-accent bg-zinc-950 px-1.5 py-0.5 text-sm font-normal text-zinc-100 outline-none"
    />
  );
}

// ── Сетка ───────────────────────────────────────────────────────────────────

/**
 * Сетка таблицы «как в Excel»: клик ставит курсор, двойной клик / Enter / F2 или
 * просто набор текста - правка, стрелки и Tab - движение, Delete - очистить ячейку,
 * Ctrl+C / Ctrl+V - копировать и вставить (блок с табуляцией ложится по ячейкам).
 * Под строками - заготовка новой строки: ввод в неё создаёт строку. Секретные
 * значения скрыты точками, пока их не открыть (👁 в ячейке или «Показать секреты»).
 */
export function TableGrid({
  doc,
  rows,
  showNewRow,
  sort,
  revealAll,
  handleRef,
  onSort,
  onEdit,
  onCopy,
  onOpenUrl,
  onNotify,
}: {
  doc: TableDoc;
  /** строки вида: после поиска и сортировки */
  rows: readonly TableRow[];
  /** заготовка новой строки (при поиске скрыта: новая строка тут же пропала бы из вида) */
  showNewRow: boolean;
  sort: TableSort | null;
  revealAll: boolean;
  handleRef?: MutableRefObject<TableGridHandle | null>;
  onSort: (columnId: string) => void;
  onEdit: (change: (doc: TableDoc) => TableDoc) => void;
  onCopy: (value: string, column: TableColumn) => void;
  onOpenUrl: (value: string) => void;
  onNotify: (text: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  const { columns } = doc;
  const order = useMemo(() => [...rows.map((r) => r.id), ...(showNewRow ? [NEW_ROW] : [])], [rows, showNewRow]);

  // курсор всегда на существующей ячейке: строку могли удалить, отфильтровать или вернуть отменой
  const cur = useMemo<Pos | null>(() => {
    const row = active !== null && order.includes(active.row) ? active.row : order[0];
    const col = active !== null && columns.some((c) => c.id === active.col) ? active.col : columns[0]?.id;
    return row === undefined || col === undefined ? null : { row, col };
  }, [active, order, columns]);

  const step = (from: Pos, dRow: number, dCol: number, wrap = false): Pos => {
    let r = Math.max(0, order.indexOf(from.row));
    let c = Math.max(0, columns.findIndex((x) => x.id === from.col)) + dCol;
    if (wrap && c >= columns.length && r < order.length - 1) {
      c = 0;
      r += 1;
    } else if (wrap && c < 0 && r > 0) {
      c = columns.length - 1;
      r -= 1;
    }
    r = clamp(r + dRow, 0, order.length - 1);
    c = clamp(c, 0, columns.length - 1);
    return { row: order[r] ?? from.row, col: columns[c]?.id ?? from.col };
  };

  const rowOf = (id: string) => rows.find((r) => r.id === id);
  const columnOf = (id: string) => columns.find((c) => c.id === id);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  useEffect(() => focusGrid(), []);

  // редактор закрылся - клавиши снова у сетки (если фокус не ушёл в другое поле)
  useEffect(() => {
    if (editing === null && renaming === null && (document.activeElement === document.body || document.activeElement === null)) {
      focusGrid();
    }
  }, [editing, renaming]);

  // курсор с клавиатуры не уезжает за край
  const curKey = cur === null ? null : `${cur.row}:${cur.col}`;
  useEffect(() => {
    if (curKey === null) return;
    const el = gridRef.current?.querySelector<HTMLElement>('td[aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [curKey]);

  const startEdit = useEvent((pos: Pos, initial: string | null = null) => {
    setActive(pos);
    setEditing({ ...pos, initial });
  });

  const commitEdit = useEvent((value: string, move: Move) => {
    const e = editing;
    if (e === null) return;
    setEditing(null);
    let pos: Pos = { row: e.row, col: e.col };
    if (e.row === NEW_ROW) {
      let created = '';
      if (value !== '') {
        onEdit((d) => {
          const added = addRow(d, { [e.col]: value });
          created = added.rowId;
          return added.doc;
        });
      }
      if (created !== '') {
        // новой строки ещё нет в order: считаем место курсора от неё сами
        const c = columns.findIndex((x) => x.id === e.col);
        const first = columns[0]?.id ?? e.col;
        if (move === 'right') {
          const next = columns[c + 1];
          setActive(next === undefined ? { row: NEW_ROW, col: first } : { row: created, col: next.id });
        } else if (move === 'left') setActive({ row: created, col: columns[Math.max(0, c - 1)]?.id ?? e.col });
        else if (move === 'down') setActive({ row: NEW_ROW, col: e.col });
        else setActive({ row: created, col: e.col });
        return;
      }
    } else {
      onEdit((d) => setCell(d, e.row, e.col, value));
    }
    if (move === 'down') pos = step(pos, 1, 0);
    else if (move === 'right') pos = step(pos, 0, 1, true);
    else if (move === 'left') pos = step(pos, 0, -1, true);
    setActive(pos);
  });

  const copyCell = useEvent((pos: Pos) => {
    const column = columnOf(pos.col);
    const value = cellOf(rowOf(pos.row), pos.col);
    if (column !== undefined && value !== '') onCopy(value, column);
  });

  const toggleReveal = useEvent((pos: Pos) =>
    setRevealed((prev) => {
      const key = `${pos.row}:${pos.col}`;
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    }),
  );

  const openCell = useEvent((pos: Pos) => onOpenUrl(cellOf(rowOf(pos.row), pos.col)));

  const deleteRow = useEvent((rowId: string) => {
    onEdit((d) => deleteRows(d, new Set([rowId])));
    onNotify('Строка удалена · Ctrl+Z — вернуть');
  });

  const cancelEdit = useEvent(() => setEditing(null));
  const startEditAt = useEvent((pos: Pos) => startEdit(pos));

  // стабильный объект: memo-строки перерисовываются только при смене своих props
  const handlers = useMemo<RowHandlers>(
    () => ({
      onSelect: setActive,
      onStartEdit: startEditAt,
      onCommit: commitEdit,
      onCancel: cancelEdit,
      onToggleReveal: toggleReveal,
      onCopy: copyCell,
      onOpen: openCell,
      onDeleteRow: deleteRow,
    }),
    [startEditAt, commitEdit, cancelEdit, toggleReveal, copyCell, openCell, deleteRow],
  );

  if (handleRef !== undefined) {
    handleRef.current = {
      startNewRow: () => {
        const first = columns[0];
        if (first !== undefined) startEdit({ row: NEW_ROW, col: first.id });
      },
      focus: focusGrid,
    };
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (cur === null || editing !== null || isTypingTarget(e.target)) return;
    if (isInteractiveTarget(e.target) && (e.key === 'Enter' || e.key === ' ')) return; // нажатие самой кнопки
    const ctrl = e.ctrlKey || e.metaKey;
    const go = (pos: Pos) => {
      e.preventDefault();
      setActive(pos);
    };
    const first = columns[0]?.id ?? cur.col;
    const last = columns.at(-1)?.id ?? cur.col;
    switch (e.key) {
      case 'ArrowUp':
        return go(step(cur, -1, 0));
      case 'ArrowDown':
        return go(step(cur, 1, 0));
      case 'ArrowLeft':
        return go(step(cur, 0, -1));
      case 'ArrowRight':
        return go(step(cur, 0, 1));
      case 'Tab':
        return go(step(cur, 0, e.shiftKey ? -1 : 1, true));
      case 'Home':
        return go({ row: ctrl ? (order[0] ?? cur.row) : cur.row, col: first });
      case 'End':
        return go({ row: ctrl ? (order.at(-1) ?? cur.row) : cur.row, col: last });
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit(cur);
        return;
      case 'Delete':
      case 'Backspace':
        if (cur.row !== NEW_ROW) {
          e.preventDefault();
          onEdit((d) => setCell(d, cur.row, cur.col, ''));
        }
        return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
      // e.code - физическая клавиша: работает и на русской раскладке
      e.preventDefault();
      copyCell(cur);
    } else if (!ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      startEdit(cur, e.key); // набор текста сразу начинает правку, как в Excel
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (cur === null || editing !== null || isTypingTarget(e.target)) return;
    const text = e.clipboardData.getData('text');
    if (text === '') return;
    e.preventDefault();
    const body = text.replace(/(\r\n|\r|\n)$/, '');
    const block = /[\t\r\n]/.test(body) ? parseDelimited(body, '\t') : [[body]];
    const startRow = order.indexOf(cur.row);
    const startCol = columns.findIndex((c) => c.id === cur.col);
    let clipped = 0;
    onEdit((d) => {
      const pasted = pasteBlock(d, rows.map((r) => r.id), startRow, startCol, block);
      clipped = pasted.clipped;
      return pasted.doc;
    });
    if (clipped > 0) onNotify(`Не поместилось значений: ${clipped} — справа не хватило столбцов`);
  };

  const insertColumn = (afterId?: string) => {
    let created = '';
    onEdit((d) => {
      const added = addColumn(d, freeColumnName(d), 'text', afterId);
      created = added.columnId;
      return added.doc;
    });
    if (created !== '') setRenaming(created); // сразу даём назвать
  };

  return (
    <div
      ref={gridRef}
      tabIndex={0}
      role="grid"
      aria-label="Таблица"
      className="min-h-0 flex-1 overflow-auto outline-none"
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 w-10 border-b border-r border-zinc-700 bg-zinc-900" />
            {columns.map((column, index) => (
              <ColumnHeader
                key={column.id}
                column={column}
                index={index}
                count={columns.length}
                sort={sort}
                renaming={renaming === column.id}
                onSort={() => onSort(column.id)}
                onRename={(name) => onEdit((d) => updateColumn(d, column.id, { name }))}
                onRenameStart={() => setRenaming(column.id)}
                onRenameEnd={() => setRenaming(null)}
                onType={(type) => onEdit((d) => updateColumn(d, column.id, { type }))}
                onMove={(delta) => onEdit((d) => moveColumn(d, column.id, delta))}
                onInsert={() => insertColumn(column.id)}
                onDelete={() => {
                  onEdit((d) => deleteColumn(d, column.id));
                  onNotify(`Столбец «${column.name}» удалён · Ctrl+Z — вернуть`);
                }}
              />
            ))}
            <th className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-900 p-0 text-left">
              <button
                type="button"
                tabIndex={-1}
                title="Добавить столбец"
                aria-label="Добавить столбец"
                className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-100"
                onClick={() => insertColumn()}
              >
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <GridRow
              key={row.id}
              row={row}
              number={i + 1}
              columns={columns}
              activeCol={cur?.row === row.id ? cur.col : null}
              editing={editing?.row === row.id ? editing : null}
              revealAll={revealAll}
              revealed={columns
                .filter((c) => c.type === 'secret' && revealed.has(`${row.id}:${c.id}`))
                .map((c) => c.id)
                .join(',')}
              handlers={handlers}
            />
          ))}
          {showNewRow && (
            <GridRow
              row={null}
              number={rows.length + 1}
              columns={columns}
              activeCol={cur?.row === NEW_ROW ? cur.col : null}
              editing={editing?.row === NEW_ROW ? editing : null}
              revealAll={revealAll}
              revealed=""
              handlers={handlers}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
