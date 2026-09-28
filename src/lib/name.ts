// Зеркало правил сервера (PATCH /entries/:id): те же проверки до запроса,
// чтобы инлайн-переименование не «прыгало» на ошибку после Enter.
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

export function validateEntryName(name: string): string | null {
  if (name.trim() === '') return 'Имя не может быть пустым';
  if (name === '.' || name === '..') return 'Такое имя недопустимо';
  if (FORBIDDEN.test(name)) return 'Символы / \\ : * ? " < > | запрещены';
  if (new TextEncoder().encode(name).length > 255) return 'Имя длиннее 255 байт';
  return null;
}
