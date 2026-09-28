import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

type PushToast = (text: string, kind?: ToastKind) => void;

const ToastCtx = createContext<PushToast>(() => undefined);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback<PushToast>((text, kind = 'info') => {
    seq += 1;
    const id = seq;
    setItems((prev) => [...prev.slice(-4), { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`max-w-sm rounded-lg border px-4 py-2 text-sm shadow-xl ${
              t.kind === 'error'
                ? 'border-red-900 bg-red-950/95 text-red-200'
                : t.kind === 'success'
                  ? 'border-emerald-900 bg-emerald-950/95 text-emerald-200'
                  : 'border-zinc-700 bg-zinc-900/95 text-zinc-200'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): PushToast {
  return useContext(ToastCtx);
}
