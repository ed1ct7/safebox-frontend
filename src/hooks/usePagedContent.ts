import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getEntry } from '../api/endpoints';
import { PREVIEW_POLL_MS, patchCachedEntries } from '../api/queries';
import type { Entry } from '../api/types';

/** Что нужно от useInfiniteQuery, чтобы догрузить остальные страницы. */
interface PagedQuery {
  data: { stale: boolean } | undefined;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  isPlaceholderData: boolean;
  fetchNextPage: () => Promise<unknown>;
  refetch: () => Promise<unknown>;
}

/** Пауза перед перечитыванием выдачи, поменявшейся на ходу: идущий импорт не превращается в шквал запросов. */
export const STALE_REFETCH_MS = 1000;
/** Перечитываний подряд, если выдача так и не сошлась (сервер считает total иначе) - дальше не крутимся. */
const STALE_REFETCH_MAX = 3;

/**
 * Догрузка всех страниц подряд (К2): первая страница уже на экране, остальные
 * идут одна за другой. Пока идёт перечитывание (isFetching) - ждём: вызов
 * fetchNextPage посреди refetch отменил бы его. Ошибка страницы останавливает
 * догрузку (видно в строке состояния), повтор - следующим перечитыванием.
 * Папка поменялась между страницами (data.stale) - перечитываем целиком.
 */
export function useAllPages(q: PagedQuery, enabled: boolean): void {
  const { hasNextPage, isFetching, isFetchNextPageError, isPlaceholderData, fetchNextPage, refetch } = q;
  const stale = q.data?.stale ?? false;
  const idle = enabled && !isFetching && !isFetchNextPageError && !isPlaceholderData;
  const tries = useRef(0);
  if (!stale) tries.current = 0;
  useEffect(() => {
    if (!idle) return;
    if (stale && tries.current < STALE_REFETCH_MAX) {
      const t = setTimeout(() => {
        tries.current += 1;
        void refetch();
      }, STALE_REFETCH_MS);
      return () => clearTimeout(t);
    }
    if (hasNextPage) void fetchNextPage(); // в том числе после STALE_REFETCH_MAX попыток - догружаем как есть
  }, [idle, stale, hasNextPage, fetchNextPage, refetch]);
}

/** Сколько ожидающих ссылок опрашивать за раз. */
const POLL_BATCH = 50;

/**
 * Предпросмотр ссылок в очереди (UF-21): раз в 2 с перечитываются только
 * ожидающие записи и подставляются в кэш (patchCachedEntries) - папка на 60k
 * записей из-за одной новой ссылки не перечитывается.
 */
export function usePreviewPoll(entries: readonly Entry[]): void {
  const qc = useQueryClient();
  const key = useMemo(
    () =>
      entries
        .filter((e) => e.previewPending === true)
        .slice(0, POLL_BATCH)
        .map((e) => e.id)
        .join(','),
    [entries],
  );
  const [round, setRound] = useState(0); // запись всё ещё ждёт - следующий круг
  useEffect(() => {
    if (key === '') return;
    const ids = key.split(',').map(Number);
    let alive = true;
    const t = setTimeout(() => {
      void Promise.all(ids.map((id) => getEntry(id).catch(() => null))).then((fresh) => {
        if (!alive) return;
        patchCachedEntries(
          qc,
          fresh.filter((e): e is Entry => e !== null),
        );
        setRound((n) => n + 1);
      });
    }, PREVIEW_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, round, qc]);
}
