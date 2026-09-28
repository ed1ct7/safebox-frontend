import type { ApiError } from './types';

// Токен — sessionStorage: переживает перезагрузку вкладки, не переживает её
// закрытие (рекомендация docs/api.md §1). В URL токен не попадает никогда:
// медиа ходит через HttpOnly-cookie sbx_media, которую сервер ставит при unlock.
const TOKEN_KEY = 'sbx_token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // приватный режим и т.п. — живём без токена между перезагрузками
  }
}

/** Любой 401 = сессия мертва: показываем экран входа (App слушает событие). */
export const UNAUTHORIZED_EVENT = 'sbx:unauthorized';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  // сервер принимает JSON только с этим Content-Type; пустое тело — без заголовка
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Нет соединения с сервером');
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let code = 'internal';
    let message = `Ошибка ${res.status}`;
    try {
      const parsed = (await res.json()) as ApiError;
      if (parsed.error !== undefined) {
        code = parsed.error.code;
        message = parsed.error.message; // готовый русский текст для формы/тоста
      }
    } catch {
      // тело не JSON — оставляем дефолт
    }
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiRequestError(res.status, code, message);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
