import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ConflictDialog } from '../components/ConflictDialog';
import type { ConflictRequest } from '../lib/conflicts';
import type { Resolutions } from '../lib/importPlan';

/** null - пользователь отменил всю операцию. */
export type AskConflicts = (request: ConflictRequest) => Promise<Resolutions | null>;

interface Pending {
  id: number;
  request: ConflictRequest;
  resolve: (answer: Resolutions | null) => void;
}

/**
 * Диалог «имя занято» как обещание: `await ask(...)`. Общий для импорта и
 * перемещения; одновременные вопросы встают в очередь и показываются по одному.
 * При размонтировании (блокировка) все ожидающие получают «отмена».
 */
export function useConflictPrompt(): { ask: AskConflicts; element: ReactElement | null } {
  const [queue, setQueue] = useState<Pending[]>([]);
  const nextId = useRef(0);
  const queueRef = useRef<Pending[]>([]);
  queueRef.current = queue;

  const ask = useCallback<AskConflicts>(
    (request) =>
      new Promise((resolve) => {
        nextId.current += 1;
        const pending = { id: nextId.current, request, resolve };
        setQueue((q) => [...q, pending]);
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const p of queueRef.current) p.resolve(null);
    },
    [],
  );

  const [head] = queue;
  const element =
    head === undefined ? null : (
      <ConflictDialog
        key={head.id}
        request={head.request}
        onDone={(answer) => {
          head.resolve(answer);
          setQueue((q) => q.filter((p) => p.id !== head.id));
        }}
      />
    );

  return { ask, element };
}
