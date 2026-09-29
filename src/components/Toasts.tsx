import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

/** Кнопка в тосте («Показать»): нажатие выполняет действие и закрывает тост. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
}

type PushToast = (text: string, kind?: ToastKind, action?: ToastAction) => void;

const ToastCtx = createContext<PushToast>(() => undefined);

const TOAST_MS = 4500;
const ERROR_TOAST_MS = 8000; // ошибку нужно успеть прочитать
const ACTION_TOAST_MS = 8000; // и до кнопки нужно успеть дотянуться
const MAX_TOASTS = 5;

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (text, kind = 'info', action) => {
      seq += 1;
      const id = seq;
      setItems((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, text, kind, action }]);
      const ms = kind === 'error' ? ERROR_TOAST_MS : action === undefined ? TOAST_MS : ACTION_TOAST_MS;
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-12 right-4 z-[70] flex flex-col items-end gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            title="Скрыть"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto max-w-sm cursor-pointer whitespace-pre-line break-words rounded-lg border px-4 py-2 text-sm shadow-xl ${
              t.kind === 'error'
                ? 'border-red-900 bg-red-950/95 text-red-200'
                : t.kind === 'success'
                  ? 'border-emerald-900 bg-emerald-950/95 text-emerald-200'
                  : 'border-zinc-700 bg-zinc-900/95 text-zinc-200'
            }`}
          >
            {t.text}
            {t.action !== undefined && (
              <button
                type="button"
                className="ml-3 rounded px-1 font-medium text-accent-hover underline-offset-2 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): PushToast {
  return useContext(ToastCtx);
}
