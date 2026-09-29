/** true, если событие клавиатуры произошло внутри поля ввода — горячие клавиши не перехватываем. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/** Enter/пробел на кнопке или ссылке — это её собственное нажатие, не наш хоткей. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a[href], [role="button"]') !== null;
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

const DOWNLOAD_GAP_MS = 250;

/**
 * Несколько скачиваний подряд (UF-9 «Скачать» для выделения). Пачка кликов
 * в одном тике теряется в браузере — разносим их по времени; Chrome один раз
 * спросит разрешение на множественную загрузку.
 */
export function triggerDownloads(urls: readonly string[]): void {
  urls.forEach((url, i) => {
    if (i === 0) triggerDownload(url);
    else setTimeout(() => triggerDownload(url), i * DOWNLOAD_GAP_MS);
  });
}
