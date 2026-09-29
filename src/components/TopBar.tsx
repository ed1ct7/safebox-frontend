import { useEffect, useRef, useState } from 'react';
import type { PendingFile } from '../api/endpoints';
import type { PathItem, SafeInfo } from '../api/types';
import { filesFromInput } from '../lib/dnd';
import { isHttpUrl } from '../lib/link';
import { supportsWatch } from '../lib/fsAccess';
import { useDismiss } from '../hooks/useDismiss';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { useToast } from './Toasts';

export interface TopBarProps {
  path: PathItem[] | null; // null — режим поиска
  searchQuery: string; // зафиксированный запрос (для крошки «Поиск: …»)
  searchText: string; // текущий текст поля (до дебаунса)
  onSearchText: (text: string) => void;
  onNavigate: (id: number | null) => void;
  onImportFiles: (files: PendingFile[]) => void;
  onWatchFolder: () => void;
  onAddLink: (url: string) => void;
  onLock: () => void;
  safe: SafeInfo | undefined;
}

const toolButton =
  'flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500';

const menuItem = 'block w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800';

export function TopBar(props: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
      <div className="min-w-0 flex-1">
        {props.path === null ? (
          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
            <span className="truncate">🔍 Поиск: «{props.searchQuery}»</span>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              title="Сбросить поиск (Esc)"
              aria-label="Сбросить поиск"
              onClick={() => props.onSearchText('')}
            >
              ✕
            </button>
          </span>
        ) : (
          <Breadcrumbs path={props.path} onNavigate={props.onNavigate} />
        )}
      </div>

      <SearchInput text={props.searchText} onText={props.onSearchText} />
      <LinkInput onAdd={props.onAddLink} />
      <ImportMenu onImportFiles={props.onImportFiles} onWatchFolder={props.onWatchFolder} />
      <SafeMenu safe={props.safe} />
      <button
        type="button"
        className={`${toolButton} hover:border-red-800 hover:text-red-200`}
        title="Заблокировать сейф: ключ стирается из памяти, нужен пароль"
        onClick={props.onLock}
      >
        🔒 Блокировка
      </button>
    </header>
  );
}

function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: PathItem[];
  onNavigate: (id: number | null) => void;
}) {
  const crumb = 'min-w-0 truncate rounded px-2 py-1 transition hover:bg-zinc-800';
  return (
    <nav aria-label="Путь" className="flex min-w-0 items-center gap-0.5 text-sm">
      <button
        type="button"
        className={`${crumb} shrink-0 ${path.length === 0 ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}
        onClick={() => onNavigate(null)}
      >
        Все объекты
      </button>
      {path.map((p, i) => {
        const last = i === path.length - 1;
        return (
          <span key={p.id} className="flex min-w-0 items-center">
            <span className="text-zinc-700">/</span>
            <button
              type="button"
              className={`${crumb} ${last ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}
              title={p.name}
              aria-current={last ? 'page' : undefined}
              onClick={() => onNavigate(p.id)}
            >
              {p.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function SearchInput({ text, onText }: { text: string; onText: (t: string) => void }) {
  return (
    <div className="relative shrink-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
        🔍
      </span>
      <input
        type="search"
        value={text}
        placeholder="Поиск по сейфу…"
        aria-label="Поиск по именам во всём сейфе"
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onText('');
          }
        }}
        className="w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 pl-7 pr-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:w-60 focus:border-accent"
      />
    </div>
  );
}

/** Добавление ссылки без окна: вставьте/наберите URL и нажмите Enter. */
function LinkInput({ onAdd }: { onAdd: (url: string) => void }) {
  const [value, setValue] = useState('');
  const toast = useToast();
  return (
    <input
      value={value}
      placeholder="Ссылка ↵"
      aria-label="Добавить ссылку"
      spellCheck={false}
      title="Вставьте ссылку и нажмите Enter — или просто Ctrl+V в любом месте окна"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setValue('');
          return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = value.trim();
        if (v === '') return;
        if (!isHttpUrl(v)) {
          toast('Это не похоже на ссылку (нужно http:// или https://)', 'error');
          return;
        }
        onAdd(v);
        setValue('');
      }}
      className="w-32 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:w-48 focus:border-accent"
    />
  );
}

function ImportMenu({
  onImportFiles,
  onWatchFolder,
}: {
  onImportFiles: (files: PendingFile[]) => void;
  onWatchFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // React не знает атрибут webkitdirectory — вешаем руками
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const pick = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };

  const onPicked = (input: HTMLInputElement) => {
    onImportFiles(filesFromInput(input));
    input.value = '';
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={toolButton}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⬆ Импорт ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
        >
          <button type="button" role="menuitem" className={menuItem} onClick={() => pick(fileRef.current)}>
            Файлы…
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => pick(folderRef.current)}>
            Папку целиком…
          </button>
          {supportsWatch() && (
            <button
              type="button"
              role="menuitem"
              className={`${menuItem} border-t border-zinc-800 text-zinc-300`}
              title="Всё новое из этой папки будет попадать в открытую папку сейфа автоматически"
              onClick={() => {
                setOpen(false);
                onWatchFolder();
              }}
            >
              👁 Следить за папкой…
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onPicked(e.currentTarget)}
      />
      <input ref={folderRef} type="file" className="hidden" onChange={(e) => onPicked(e.currentTarget)} />
    </div>
  );
}

/** Меню сейфа (UF-12): полный путь файла и смена пароля. */
function SafeMenu({ safe }: { safe: SafeInfo | undefined }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);

  const name = safe === undefined ? 'Сейф' : (safe.path.split(/[\\/]/).pop() ?? safe.path);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`${toolButton} max-w-56`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={safe?.path}
        onClick={() => setOpen((o) => !o)}
      >
        🗄 <span className="truncate">{name}</span> ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
        >
          {safe !== undefined && (
            <p className="break-all border-b border-zinc-800 px-3 pb-2 pt-1 text-xs text-zinc-500">
              {safe.path}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
          >
            Сменить пароль…
          </button>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}
