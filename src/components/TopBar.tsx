import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import type { PathItem, SafeInfo } from '../api/types';
import { filesFromInput } from '../lib/dnd';
import { isHttpUrl } from '../lib/link';
import { supportsWatch } from '../lib/fsAccess';
import { useDismiss } from '../hooks/useDismiss';
import { useToast } from './Toasts';

const MIN_PASSWORD = 6;

export interface TopBarProps {
  path: PathItem[] | null; // null — режим поиска
  searchQuery: string; // зафиксированный запрос (для чипа «Поиск: …»)
  searchText: string; // текущий текст поля (пока с дебаунсом)
  onSearchText: (text: string) => void;
  onClearSearch: () => void;
  onNavigate: (id: number | null) => void;
  onImportFiles: (files: PendingFile[]) => void;
  onWatchFolder: () => void;
  onAddLink: (url: string) => void;
  onLock: () => void;
  safe: SafeInfo | undefined;
}

export function TopBar(props: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
      <div className="min-w-0 flex-1">
        {props.path === null ? (
          <span className="flex items-center gap-2 truncate text-sm text-zinc-300">
            🔍 Поиск: «{props.searchQuery}»
            <button
              className="rounded px-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              title="Сбросить поиск (Esc)"
              onClick={props.onClearSearch}
            >
              ✕
            </button>
          </span>
        ) : (
          <nav className="flex min-w-0 items-center gap-0.5 text-sm">
            <button
              className="shrink-0 rounded px-2 py-1 text-zinc-300 transition hover:bg-zinc-800"
              onClick={() => props.onNavigate(null)}
            >
              Все объекты
            </button>
            {props.path.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center">
                <span className="text-zinc-700">/</span>
                <button
                  className="min-w-0 truncate rounded px-2 py-1 text-zinc-300 transition hover:bg-zinc-800"
                  title={p.name}
                  onClick={() => props.onNavigate(p.id)}
                >
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      <SearchInput text={props.searchText} onText={props.onSearchText} />
      <LinkInput onAdd={props.onAddLink} />
      <ImportMenu onImportFiles={props.onImportFiles} onWatchFolder={props.onWatchFolder} />
      <SafeMenu safe={props.safe} onLock={props.onLock} />
    </header>
  );
}

function SearchInput({ text, onText }: { text: string; onText: (t: string) => void }) {
  return (
    <div className="relative shrink-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
        🔍
      </span>
      <input
        value={text}
        placeholder="Поиск…"
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
      spellCheck={false}
      title="Вставьте ссылку и нажмите Enter — или просто Ctrl+V в любом месте окна"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
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
      className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:w-48 focus:border-accent"
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
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false));
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

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500"
        onClick={() => setOpen((o) => !o)}
      >
        ⬆ Импорт ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={() => pick(fileRef.current)}
          >
            Файлы…
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={() => pick(folderRef.current)}
          >
            Папку целиком…
          </button>
          {supportsWatch() && (
            <button
              className="block w-full border-t border-zinc-800 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
              title="Всё новое из этой папки будет попадать в сейф автоматически"
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
        onChange={(e) => {
          onImportFiles(filesFromInput(e.currentTarget));
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={folderRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          onImportFiles(filesFromInput(e.currentTarget));
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

function SafeMenu({ safe, onLock }: { safe: SafeInfo | undefined; onLock: () => void }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => {
    setOpen(false);
    setChanging(false);
  });
  const toast = useToast();

  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const passwordMut = useMutation({
    mutationFn: () => changePassword(oldPassword, newPassword, confirm),
    onSuccess: () => {
      toast('Пароль изменён', 'success');
      setOpen(false);
      setChanging(false);
      setOld('');
      setNew('');
      setConfirm('');
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const submitPassword = () => {
    setError(null);
    if (newPassword.length < MIN_PASSWORD) {
      setError(`Новый пароль — минимум ${MIN_PASSWORD} символов`);
      return;
    }
    if (newPassword !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    passwordMut.mutate();
  };

  const name = safe === undefined ? '' : (safe.path.split(/[\\/]/).pop() ?? safe.path);

  const fieldClass =
    'w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-accent';

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        className="flex max-w-56 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500"
        onClick={() => setOpen((o) => !o)}
        title={safe?.path}
      >
        🔒 <span className="truncate">{name}</span> ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
          {changing ? (
            <form
              className="flex w-72 flex-col gap-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitPassword();
              }}
            >
              <input
                type="password"
                autoFocus
                placeholder="Старый пароль"
                className={fieldClass}
                value={oldPassword}
                onChange={(e) => setOld(e.target.value)}
              />
              <input
                type="password"
                placeholder="Новый пароль"
                className={fieldClass}
                value={newPassword}
                onChange={(e) => setNew(e.target.value)}
              />
              <input
                type="password"
                placeholder="Повторите новый"
                className={fieldClass}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {error !== null && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200"
                  onClick={() => {
                    setChanging(false);
                    setError(null);
                  }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={passwordMut.isPending}
                  className="rounded bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Сменить
                </button>
              </div>
            </form>
          ) : (
            <>
              <button
                className="block w-full px-4 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                onClick={() => setChanging(true)}
              >
                Сменить пароль
              </button>
              <button
                className="block w-full px-4 py-1.5 text-left text-sm text-red-300 hover:bg-zinc-800"
                onClick={onLock}
              >
                Заблокировать
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
