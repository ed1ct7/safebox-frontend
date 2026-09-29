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

/** Копирование в буфер: Clipboard API, а если он недоступен или отказал — через выделение. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // нет разрешения или небезопасный контекст — пробуем старый способ
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Текст файла в UTF-8. FileReader вместо Blob.text(): тот есть не везде (jsdom). */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsText(file);
  });
}
