// «Места» - до 9 папок на цифрах 1–9 (быстрое перемещение из просмотра и галереи)
// и недавние папки назначения. Хранятся в localStorage; испорченное значение
// читается как пустое - интерфейс от него не падает.

export const PLACES_KEY = 'sbx_places';
export const RECENT_MOVES_KEY = 'sbx_move_recent';
export const MAX_PLACES = 9;
export const MAX_RECENT = 8;

/** Слоты мест: индекс = цифра - 1, null - свободный слот. Цифры у папок не сдвигаются. */
export type Places = readonly (number | null)[];

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function parsePlaces(raw: string | null): Places {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<number>();
    const out = v.slice(0, MAX_PLACES).map((x) => {
      if (!isId(x) || seen.has(x)) return null;
      seen.add(x);
      return x;
    });
    return trimTail(out);
  } catch {
    return [];
  }
}

export function parseRecent(raw: string | null): number[] {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter(isId))].slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function trimTail(slots: (number | null)[]): (number | null)[] {
  let end = slots.length;
  while (end > 0 && slots[end - 1] === null) end -= 1;
  return slots.slice(0, end);
}

/** Цифра места папки (1–9) или undefined. */
export function placeDigit(places: Places, id: number): number | undefined {
  const i = places.indexOf(id);
  return i < 0 ? undefined : i + 1;
}

/** Папка на цифре (1–9) или undefined. */
export function placeAt(places: Places, digit: number): number | undefined {
  return places[digit - 1] ?? undefined;
}

export function isPlacesFull(places: Places): boolean {
  return places.length >= MAX_PLACES && places.every((p) => p !== null);
}

/** Добавить в первый свободный слот или убрать. Все 9 заняты - без изменений. */
export function togglePlace(places: Places, id: number): Places {
  const i = places.indexOf(id);
  if (i >= 0) return trimTail(places.map((p) => (p === id ? null : p)));
  const free = places.indexOf(null);
  if (free >= 0) return places.map((p, k) => (k === free ? id : p));
  if (places.length < MAX_PLACES) return [...places, id];
  return places;
}

/** Папка назначения - в начало недавних. */
export function pushRecent(recent: readonly number[], id: number): number[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
}

/** Цифра клавиши 1–9 по e.code (верхний ряд и цифровой блок; раскладка не важна). */
export function digitOfKey(code: string): number | undefined {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m === null ? undefined : Number(m[1]);
}
