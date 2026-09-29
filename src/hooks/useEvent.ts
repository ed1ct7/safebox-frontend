import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Стабильная ссылка на функцию, которая всегда видит свежие props/state.
 * Позволяет не пересоздавать обработчики (и не перерисовывать memo-карточки)
 * на каждое изменение выделения.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Подписка на событие window со свежим обработчиком без переподписки. */
export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  handler: (e: WindowEventMap[K]) => void,
): void {
  const stable = useEvent(handler);
  useEffect(() => {
    window.addEventListener(type, stable);
    return () => window.removeEventListener(type, stable);
  }, [type, stable]);
}
