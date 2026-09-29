import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSafe, getSafeStatus, unlockSafe } from '../api/endpoints';
import type { Session } from '../api/types';
import { ApiRequestError, errorMessage } from '../api/client';
import { validateNewPassword } from '../lib/rules';
import { useToast } from './Toasts';

type Mode = 'open' | 'create';

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent';

/**
 * Экран входа: «Открыть» (UF-2) и «Создать новый» (UF-1). Путь последнего
 * сейфа подставляется; если сейфов ещё не было — сразу вкладка «Создать».
 * Ошибки формы (неверный пароль, файл существует, не сейф…) — на форме,
 * нет соединения с сервером — тостом.
 */
export function LoginScreen({ onSession }: { onSession: (s: Session) => void }) {
  const toast = useToast();
  const statusQuery = useQuery({ queryKey: ['login-status'], queryFn: getSafeStatus });
  const status = statusQuery.data;

  const [mode, setMode] = useState<Mode>('open');
  // у вкладок свои пути: путь существующего сейфа в «Создать» дал бы 409
  const [openPath, setOpenPath] = useState('');
  const [createPath, setCreatePath] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openPathTouched = useRef(false);
  const prefillDone = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === undefined || prefillDone.current) return;
    prefillDone.current = true;
    if (status.lastPath === null) {
      setMode('create');
    } else if (!openPathTouched.current) {
      setOpenPath(status.lastPath);
      passwordRef.current?.focus(); // путь известен — сразу вводим пароль
    }
  }, [status]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword('');
    setConfirm('');
  };

  const path = mode === 'open' ? openPath : createPath;

  const submit = async () => {
    if (busy) return;
    setError(null);
    const trimmed = path.trim();
    if (trimmed === '') {
      setError('Укажите путь к файлу сейфа');
      return;
    }
    if (mode === 'create') {
      const invalid = validateNewPassword(password, confirm);
      if (invalid !== null) {
        setError(invalid);
        return;
      }
    } else if (password === '') {
      setError('Введите пароль');
      return;
    }
    setBusy(true);
    try {
      const session =
        mode === 'create'
          ? await createSafe(trimmed, password, confirm)
          : await unlockSafe(trimmed, password);
      onSession(session);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'network') {
        toast(e.message, 'error'); // UF-2: нет соединения — тост
      } else {
        // message сервера уже готов для показа на форме
        setError(errorMessage(e, 'Не удалось открыть сейф'));
      }
    } finally {
      setBusy(false);
    }
  };

  const defaultDir = status?.defaultDirectory ?? '';
  const sep = defaultDir.includes('/') && !defaultDir.includes('\\') ? '/' : '\\';
  const createPlaceholder = defaultDir === '' ? 'Мой сейф' : `${defaultDir}${sep}Мой сейф`;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="text-3xl" aria-hidden="true">
            🔒
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">SafeBox</h1>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl">
          {statusQuery.isError && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              <span>Нет соединения с сервером. Убедитесь, что запущен safeboxd.</span>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-0.5 text-red-200 underline-offset-2 hover:underline"
                onClick={() => void statusQuery.refetch()}
              >
                Повторить
              </button>
            </div>
          )}

          <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
            {(
              [
                ['open', 'Открыть'],
                ['create', 'Создать новый'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-md py-1.5 text-sm font-medium transition ${
                  mode === m ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-400">
                  {mode === 'create' ? 'Путь к новому сейфу' : 'Путь к сейфу'}
                </span>
                <input
                  className={inputClass}
                  value={path}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="safe-path-hint"
                  placeholder={mode === 'create' ? createPlaceholder : 'C:\\…\\Мой сейф.safebox'}
                  onChange={(e) => {
                    if (mode === 'open') {
                      openPathTouched.current = true;
                      setOpenPath(e.target.value);
                    } else {
                      setCreatePath(e.target.value);
                    }
                  }}
                />
              </label>
              <span id="safe-path-hint" className="text-[11px] text-zinc-600">
                {mode === 'create'
                  ? 'Расширение .safebox добавится автоматически'
                  : 'Расширение .safebox можно не писать'}
                {defaultDir !== '' && ` · относительный путь — от ${defaultDir}`}
              </span>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Пароль</span>
              <input
                ref={passwordRef}
                type="password"
                className={inputClass}
                value={password}
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {mode === 'create' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-400">Повторите пароль</span>
                <input
                  type="password"
                  className={inputClass}
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}

            {error !== null && (
              <div
                role="alert"
                className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {busy && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {mode === 'create' ? 'Создать сейф' : 'Войти'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          Локальный зашифрованный сейф: всё содержимое — в одном файле
        </p>
      </div>
    </div>
  );
}
