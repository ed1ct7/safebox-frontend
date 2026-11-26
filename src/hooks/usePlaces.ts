import { useCallback, useEffect, useState } from 'react';
import {
  parsePlaces,
  parseRecent,
  PLACES_KEY,
  pushRecent,
  RECENT_MOVES_KEY,
  togglePlace as toggleIn,
} from '../lib/places';
import type { Places } from '../lib/places';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // хранилище недоступно - начинаем с пустого
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // не сохранилось - доживёт до перезагрузки
  }
}

export interface PlacesApi {
  places: Places;
  recent: readonly number[];
  /** добавить папку в «Места» (первый свободный слот) или убрать; false - все 9 заняты */
  togglePlace: (id: number) => boolean;
  addRecent: (id: number) => void;
}

/** «Места» на цифрах 1–9 и недавние папки назначения (lib/places). */
export function usePlaces(): PlacesApi {
  const [places, setPlaces] = useState<Places>(() => parsePlaces(read(PLACES_KEY)));
  const [recent, setRecent] = useState<readonly number[]>(() => parseRecent(read(RECENT_MOVES_KEY)));

  useEffect(() => write(PLACES_KEY, places), [places]);
  useEffect(() => write(RECENT_MOVES_KEY, recent), [recent]);

  const togglePlace = useCallback(
    (id: number) => {
      const next = toggleIn(places, id);
      if (next === places) return false;
      setPlaces(next);
      return true;
    },
    [places],
  );
  const addRecent = useCallback((id: number) => setRecent((r) => pushRecent(r, id)), []);

  return { places, recent, togglePlace, addRecent };
}
