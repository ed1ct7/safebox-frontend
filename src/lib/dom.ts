/** true, если событие клавиатуры произошло внутри поля ввода — горячие клавиши не перехватываем. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const el = target as HTMLElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  );
}

/** Скачивание через cookie-эндпоинты: имя файла придёт в Content-Disposition. */
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
