// Зеркало правил домена сервера (safebox/domain/model/rules.hpp): те же проверки
// до запроса, чтобы форма не «прыгала» на ошибку после отправки.

import { isHttpUrl } from './link';

/** kMinPasswordLength: создание сейфа и смена пароля (UF-1, UF-12). */
export const MIN_PASSWORD_LENGTH = 6;

/** Пароль и повтор для создания сейфа / смены пароля; null — всё в порядке. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль — минимум ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (password !== confirm) return 'Пароли не совпадают';
  return null;
}

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/** Имя записи для PATCH /entries/:id; null — корректно. */
export function validateEntryName(name: string): string | null {
  if (name.trim() === '') return 'Имя не может быть пустым';
  if (name === '.' || name === '..') return 'Такое имя недопустимо';
  if (FORBIDDEN.test(name)) return 'Символы / \\ : * ? " < > | запрещены';
  if (new TextEncoder().encode(name).length > 255) return 'Имя длиннее 255 байт';
  return null;
}

/** Предел описания на сервере (UF-22): 64 КиБ в UTF-8. */
export const MAX_DESCRIPTION_BYTES = 64 * 1024;

/** Описание записи для PATCH /entries/:id; null — корректно. Пустое описание допустимо. */
export function validateDescription(text: string): string | null {
  if (new TextEncoder().encode(text).length > MAX_DESCRIPTION_BYTES) {
    return 'Описание длиннее 64 КиБ';
  }
  return null;
}

const MAX_TAG_NAME_CHARS = 100;

/**
 * Имя тега или категории (UF-16): зеркало validateTagName сервера - без пробелов
 * по краям не пусто, до 100 символов, без «:» (это разделитель «категория:тег») и
 * управляющих символов. null - корректно.
 */
export function validateTagName(name: string, what: 'тега' | 'категории' = 'тега'): string | null {
  const text = name.trim();
  if (text === '') return `Имя ${what} не может быть пустым`;
  if ([...text].length > MAX_TAG_NAME_CHARS) return `Имя ${what} длиннее ${MAX_TAG_NAME_CHARS} символов`;
  if (text.includes(':')) return `Символ «:» в имени ${what} запрещён`;
  if (/[\u0000-\u001f\u007f]/.test(text)) return `Управляющие символы в имени ${what} запрещены`;
  return null;
}

/** Адрес ссылки для PATCH /entries/:id; null — корректно. */
export function validateLinkUrl(url: string): string | null {
  return isHttpUrl(url) ? null : 'Нужен адрес http:// или https://';
}
