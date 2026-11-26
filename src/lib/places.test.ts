import { describe, expect, it } from 'vitest';
import {
  digitOfKey,
  isPlacesFull,
  parsePlaces,
  parseRecent,
  placeAt,
  placeDigit,
  pushRecent,
  togglePlace,
} from './places';

describe('места', () => {
  it('испорченное хранилище читается как пустое, лишнее отбрасывается', () => {
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces('{нет')).toEqual([]);
    expect(parsePlaces('{"a":1}')).toEqual([]);
    expect(parsePlaces('[5, "x", 5, -1, 7, null, null]')).toEqual([5, null, null, null, 7]);
    expect(parsePlaces(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toHaveLength(9);
    expect(parseRecent('[3, 3, 0, 4.5, 8]')).toEqual([3, 8]);
  });

  it('добавление - в первый свободный слот, цифры других не сдвигаются', () => {
    let p = togglePlace([], 10);
    p = togglePlace(p, 20);
    p = togglePlace(p, 30);
    expect(placeDigit(p, 30)).toBe(3);
    p = togglePlace(p, 20); // убрали вторую
    expect(p).toEqual([10, null, 30]);
    expect(placeDigit(p, 30)).toBe(3);
    expect(placeAt(p, 2)).toBeUndefined();
    p = togglePlace(p, 40);
    expect(placeDigit(p, 40)).toBe(2);
    expect(togglePlace([10], 10)).toEqual([]);
  });

  it('все 9 заняты - без изменений', () => {
    const full = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(isPlacesFull(full)).toBe(true);
    expect(togglePlace(full, 10)).toBe(full);
    expect(isPlacesFull([1, null, 3])).toBe(false);
  });

  it('недавние: новая - в начало, без повторов, не больше 8', () => {
    expect(pushRecent([1, 2, 3], 2)).toEqual([2, 1, 3]);
    expect(pushRecent([1, 2, 3, 4, 5, 6, 7, 8], 9)).toEqual([9, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('цифра по коду клавиши: верхний ряд и цифровой блок, без 0', () => {
    expect(digitOfKey('Digit1')).toBe(1);
    expect(digitOfKey('Numpad9')).toBe(9);
    expect(digitOfKey('Digit0')).toBeUndefined();
    expect(digitOfKey('KeyM')).toBeUndefined();
  });
});
