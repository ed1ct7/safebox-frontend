import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSafe, getSafeStatus, unlockSafe } from '../api/endpoints';
import type { Session } from '../api/types';
import { ApiRequestError } from '../api/client';

type Mode = 'open' | 'create';

const MIN_PASSWORD = 6;

export function LoginScreen({ onSession }: { onSession: (s: Session) => void }) {
  const statusQuery = useQuery({ queryKey: ['login-status'], queryFn: getSafeStatus });
  const status = statusQuery.data;

  const [mode, setMode] = useState<Mode>('open');
  const [path, setPath] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pathTouched = useRef(false);
  const prefillDone = useRef(false);

  // UF-1/UF-2: путь последнего сейфа подставляется; если сейфов ещё не было —
  // сразу вкладка «Создать»
  useEffect(() => {
    if (status === undefined || prefillDone.current) return;
    prefillDone.current = true;
    if (status.lastPath !== null && !pathTouched.current) setPath(status.lastPath);
    if (status.lastPath === null) setMode('create');
  }, [status]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (path.trim() === '') {
      setError('Укажите путь к файлу сейфа');
      return;
    }
    if (mode === 'create') {
      if (password.length < MIN_PASSWORD) {
        setError(`Пароль — минимум ${MIN_PASSWORD} символов`);
        return;
      }
      if (password !== confirm) {
        setError('Пароли не совпадают');
        return;
      }
    }
    setBusy(true);
    try {
      const session =
        mode === 'create'
          ? await createSafe(path.trim(), password, confirm)
          : await unlockSafe(path.trim(), password);
      onSession(session);
    } catch (e) {
      // message сервера уже готов для показа на форме (docs/api.md §2)
      setError(e instanceof ApiRequestError ? e.message : 'Не удалось открыть сейф');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="text-3xl">🔒</span>
          <h1 className="text-2xl font-semibold tracking-tight">SafeBox</h1>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl">
          {statusQuery.isError && (
            <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              Нет соединения с сервером. Убедитесь, что запущен safeboxd (порт 8900).
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
            {(
              [
                ['open', 'Открыть'],
                ['create', 'Создать новый'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
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
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-400">
                {mode === 'create' ? 'Путь к новому сейфу' : 'Путь к сейфу'}
              </span>
              <input
                className={inputClass}
                value={path}
                spellCheck={false}
                placeholder={
                  mode === 'create'
                    ? (status?.defaultDirectory ?? '') + '\\Мой сейф'
                    : 'C:\\…\\Мой сейф.safebox'
                }
                onChange={(e) => {
                  pathTouched.current = true;
                  setPath(e.target.value);
                }}
              />
              {mode === 'create' && (
                <span className="text-[11px] text-zinc-600">
                  Расширение .safebox добавится автоматически
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Пароль</span>
              <input
                type="password"
                className={inputClass}
                value={password}
                autoComplete="current-password"
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
              <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
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
