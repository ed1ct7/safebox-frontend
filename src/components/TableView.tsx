import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { useEvent } from '../hooks/useEvent';
import { useTableDoc } from '../hooks/useTableDoc';
import type { TableSave } from '../hooks/useTableDoc';
import { copyText, isTypingTarget, triggerDownload } from '../lib/dom';
import { plural } from '../lib/format';
import { isHttpUrl } from '../lib/link';
import { decodeCsvBytes, importMatrix, nextSort, parseDelimited, tableTitle, toCsv, viewRows } from '../lib/table';
import type { TableColumn, TableSort } from '../lib/table';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import { Modal } from './Modal';
import { TableGrid } from './TableGrid';
import type { TableGridHandle } from './TableGrid';
import { useToast } from './Toasts';

export interface TableViewHandle {
  /** Дописать несохранённое (перед блокировкой сейфа); false - записать не удалось. */
  saveNow: () => Promise<boolean>;
}

const toolButton =
  'flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500 disabled:pointer-events-none disabled:opacity-40';

const menuItem = 'block w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800';

function readBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsArrayBuffer(file);
  });
}

function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Адрес из ячейки: «example.com/login» открывается как https. null - это не адрес. */
function urlOf(value: string): string | null {
  const v = value.trim();
  if (isHttpUrl(v)) return v;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(v) && isHttpUrl(`https://${v}`) ? `https://${v}` : null;
}

function SaveStatus({ save, onRetry }: { save: TableSave; onRetry: () => void }) {
  if (save.state === 'error') {
    return (
      <span role="alert" className="flex min-w-0 items-center gap-2 text-sm text-red-300">
        <span className="truncate" title={save.message}>
          Не сохранено: {save.message}
        </span>
        <button type="button" className="shrink-0 rounded border border-red-800 px-2 py-0.5 hover:border-red-500" onClick={onRetry}>
          Повторить
        </button>
      </span>
    );
  }
  const text =
    save.state === 'saved'
      ? 'Сохранено'
      : save.state === 'saving'
        ? 'Сохранение…'
        : save.state === 'conflict'
          ? 'Не сохранено'
          : 'Изменено…';
  return (
    <span
      role="status"
      className={`shrink-0 text-sm ${save.state === 'saved' ? 'text-zinc-500' : save.state === 'conflict' ? 'text-amber-300' : 'text-zinc-300'}`}
    >
      {text}
    </span>
  );
}

/**
 * Таблица на весь экран: записи по столбцам (пароли, карты, любые списки). Правки
 * сохраняются сами через мгновение после ввода - в тот же зашифрованный файл записи.
 * Секретные столбцы скрыты точками; «Показать секреты» открывает все разом. Поиск
 * отбирает строки (по несекретным столбцам), клик по заголовку сортирует - ни то, ни
 * другое в файл не попадает. Закрытие (Esc, «Назад») сначала дописывает несохранённое.
 */
export function TableView({
  entry,
  onClose,
  onSaved,
  handleRef,
}: {
  entry: Entry; // запись с карточки: имя в шапке, пока таблица читается
  onClose: () => void;
  /** таблица записана: свежая запись (размер и дата на карточке) */
  onSaved?: (entry: Entry) => void;
  handleRef?: MutableRefObject<TableViewHandle | null>;
}) {
  const toast = useToast();
  const [fresh, setFresh] = useState(entry);
  const table = useTableDoc(entry.id, {
    onSaved: (e) => {
      setFresh(e);
      onSaved?.(e);
    },
    onLoaded: setFresh,
  });
  const { doc } = table;

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TableSort | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(() => setMenuOpen(false), menuOpen);
  const gridRef = useRef<TableGridHandle | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);

  const { saveNow } = table;
  useEffect(() => {
    if (handleRef === undefined) return;
    handleRef.current = { saveNow };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, saveNow]);

  const title = tableTitle(fresh.name);
  const rows = useMemo(() => (doc === null ? [] : viewRows(doc, query, sort)), [doc, query, sort]);
  const searching = query.trim() !== '';

  const requestClose = useEvent(async () => {
    if (closing.current) return;
    closing.current = true;
    const saved = await table.saveNow();
    closing.current = false;
    if (saved) {
      onClose();
      return;
    }
    setConfirm({
      title: 'Закрыть без сохранения?',
      message: 'Последние изменения не записаны в сейф. Если закрыть таблицу сейчас, они пропадут.',
      confirmLabel: 'Закрыть без сохранения',
      danger: true,
      onConfirm: onClose,
    });
  });

  const copyCell = useEvent(async (value: string, column: TableColumn) => {
    const ok = await copyText(value);
    // значение в тост не попадает: на экране его могло не быть (секрет)
    toast(ok ? `Скопировано: ${column.name}` : 'Не удалось скопировать', ok ? 'success' : 'error');
  });

  const openUrl = useEvent((value: string) => {
    const url = urlOf(value);
    if (url === null) {
      toast('Это не адрес сайта', 'error');
      return;
    }
    // как у ссылок сейфа (UF-6): внешняя страница - только после подтверждения
    setConfirm({
      title: 'Открыть внешнюю ссылку?',
      message: url,
      confirmLabel: 'Открыть',
      onConfirm: () => window.open(url, '_blank', 'noopener,noreferrer'),
    });
  });

  const addRowNow = () => {
    setQuery(''); // при поиске новая строка сразу пропала бы из вида
    // заготовка появится после перерисовки без поиска
    requestAnimationFrame(() => gridRef.current?.startNewRow());
  };

  const importCsv = async (file: File) => {
    try {
      const matrix = parseDelimited(decodeCsvBytes(await readBytes(file)));
      let added = 0;
      table.edit((d) => {
        const result = importMatrix(d, matrix);
        added = result.added;
        return result.doc;
      });
      toast(
        added > 0 ? `Из файла добавлено: ${plural(added, 'строка', 'строки', 'строк')}` : 'В файле нет строк с данными',
        added > 0 ? 'success' : 'info',
      );
    } catch {
      toast('Не удалось прочитать файл', 'error');
    }
  };

  const exportCsv = () => {
    if (doc === null) return;
    setConfirm({
      title: 'Сохранить таблицу в CSV?',
      message:
        'Файл CSV не зашифрован: всё содержимое таблицы, включая секретные столбцы, окажется на диске открытым текстом.',
      confirmLabel: 'Сохранить CSV',
      onConfirm: () => downloadText(`${title}.csv`, toCsv(doc), 'text/csv;charset=utf-8'),
    });
  };

  const downloadFile = async () => {
    if (await table.saveNow()) triggerDownload(mediaUrl(entry.id, 'download'));
    else toast('Сначала нужно сохранить таблицу', 'error');
  };

  // Ctrl+Z / Ctrl+Y / Ctrl+F на весь экран таблицы; в полях ввода - их собственные
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.code === 'KeyF') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      table.undo();
    } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
      e.preventDefault();
      table.redo();
    }
  };

  return (
    <Modal onClose={() => void requestClose()} label={`Таблица «${title}»`} className="bg-zinc-950">
      <div className="flex h-full w-full flex-col" onKeyDown={onKeyDown}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
          <button type="button" className={toolButton} title="Закрыть таблицу (Esc)" onClick={() => void requestClose()}>
            ← Назад
          </button>
          <h2 className="min-w-0 flex-1 truncate text-base font-medium text-zinc-100" title={title}>
            <span className="mr-2 text-zinc-500" aria-hidden="true">
              ▦
            </span>
            {title}
          </h2>

          <SaveStatus save={table.save} onRetry={() => void table.saveNow()} />

          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Поиск в таблице…"
            aria-label="Поиск в таблице"
            title="Отбор строк по словам (Ctrl+F); секретные столбцы в поиске не участвуют"
            spellCheck={false}
            disabled={doc === null}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query !== '') setQuery('');
                else gridRef.current?.focus();
              } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                gridRef.current?.focus();
              }
            }}
            className="w-52 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-accent"
          />
          <button type="button" className={toolButton} disabled={doc === null} onClick={addRowNow}>
            + Строка
          </button>
          <button
            type="button"
            className={`${toolButton} ${revealAll ? 'border-accent text-zinc-100' : ''}`}
            aria-pressed={revealAll}
            disabled={doc === null}
            title="Показать или скрыть значения всех секретных столбцов"
            onClick={() => setRevealAll((v) => !v)}
          >
            {revealAll ? '🙈 Скрыть секреты' : '👁 Показать секреты'}
          </button>
          <button
            type="button"
            className={toolButton}
            disabled={!table.canUndo}
            title="Отменить правку (Ctrl+Z)"
            aria-label="Отменить правку"
            onClick={table.undo}
          >
            ↶
          </button>
          <button
            type="button"
            className={toolButton}
            disabled={!table.canRedo}
            title="Вернуть правку (Ctrl+Y)"
            aria-label="Вернуть правку"
            onClick={table.redo}
          >
            ↷
          </button>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              className={toolButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Ещё: импорт и экспорт"
              disabled={doc === null}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  title="Первая строка файла — названия столбцов. Подходит экспорт паролей из браузера"
                  onClick={() => {
                    setMenuOpen(false);
                    csvRef.current?.click();
                  }}
                >
                  Добавить строки из CSV…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    exportCsv();
                  }}
                >
                  Сохранить как CSV…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItem} border-t border-zinc-800`}
                  title="Файл таблицы как он лежит в сейфе (JSON, не зашифрован)"
                  onClick={() => {
                    setMenuOpen(false);
                    void downloadFile();
                  }}
                >
                  Скачать файл таблицы
                </button>
              </div>
            )}
          </div>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            aria-label="Файл CSV"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file !== undefined) void importCsv(file);
            }}
          />
        </header>

        {table.save.state === 'conflict' && (
          <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-amber-900 bg-amber-950/60 px-4 py-2 text-sm text-amber-100">
            <span className="min-w-0 flex-1">
              Эту таблицу изменили в другом окне, пока она была открыта здесь. Ваши правки пока не сохранены.
            </span>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-amber-700 px-3 py-1 hover:border-amber-500"
              title="Правки, сделанные здесь, пропадут"
              onClick={table.reload}
            >
              Загрузить из сейфа
            </button>
            <button
              type="button"
              className="shrink-0 rounded-lg bg-amber-700 px-3 py-1 text-white hover:bg-amber-600"
              title="Правки из другого окна пропадут"
              onClick={() => void table.overwrite()}
            >
              Сохранить мою версию
            </button>
          </div>
        )}

        {table.load.status === 'loading' && (
          <div className="flex flex-1 items-center justify-center" aria-busy="true">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
          </div>
        )}

        {table.load.status === 'error' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p role="alert" className="max-w-md text-sm text-zinc-300">
              {table.load.message}
            </p>
            <div className="flex gap-2">
              <button type="button" className={toolButton} onClick={table.reload}>
                Повторить
              </button>
              <button type="button" className={toolButton} onClick={() => triggerDownload(mediaUrl(entry.id, 'download'))}>
                Скачать файл
              </button>
            </div>
          </div>
        )}

        {doc !== null && (
          <>
            <TableGrid
              doc={doc}
              rows={rows}
              showNewRow={!searching}
              sort={sort}
              revealAll={revealAll}
              handleRef={gridRef}
              onSort={(columnId) => setSort((s) => nextSort(s, columnId))}
              onEdit={table.edit}
              onCopy={(value, column) => void copyCell(value, column)}
              onOpenUrl={openUrl}
              onNotify={(text) => toast(text, 'info')}
            />
            <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-zinc-800 px-4 text-xs text-zinc-500">
              <span>
                {searching
                  ? `Найдено: ${rows.length} из ${doc.rows.length}`
                  : plural(doc.rows.length, 'строка', 'строки', 'строк')}
              </span>
              <span className="min-w-0 truncate">
                Enter — править и вниз · Tab — вправо · Esc — отмена правки · Delete — очистить · Ctrl+C / Ctrl+V —
                копировать и вставить (блок из Excel ложится по ячейкам) · Ctrl+Z — отменить
              </span>
            </footer>
          </>
        )}
      </div>
      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </Modal>
  );
}
