// История последних сейфов для экрана входа (UF-2): чтобы каждый раз не
// прописывать путь. Хранится в localStorage браузера/WebView и живёт между
// запусками; путь последнего сейфа сервер и так подставляет (safe/status).

const KEY = 'sbx_recent_safes';
const LIMIT = 8;

/** Путь уже в списке? Сравнение без учёта регистра и краёв. */
function samePath(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function save(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // приватный режим или хранилище недоступно - история просто не сохранится
  }
}

/** Сохранённые последние сейфы, свежие первыми; битое содержимое игнорируется. */
export function loadRecentSafes(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  } catch {
    return [];
  }
}

/** Запомнить сейф (после успешного входа или создания): наверх, без дублей. */
export function rememberSafe(path: string): void {
  const trimmed = path.trim();
  if (trimmed === '') return;
  save([trimmed, ...loadRecentSafes().filter((p) => !samePath(p, trimmed))].slice(0, LIMIT));
}

/** Убрать из списка (крестик у строки на экране входа). */
export function forgetSafe(path: string): void {
  save(loadRecentSafes().filter((p) => !samePath(p, path)));
}
