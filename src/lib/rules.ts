// Зеркало правил домена сервера (safebox/domain/model/rules.hpp): те же проверки
// до запроса, чтобы форма не «прыгала» на ошибку после отправки.

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
