/** Сворачивание имён для сравнения и поиска: без регистра, «ё» = «е» (как foldForSearch сервера). */
export function foldForSearch(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/ё/g, 'е');
}
