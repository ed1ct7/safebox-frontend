import type { ApiError } from './types';

// Токен — sessionStorage: переживает перезагрузку вкладки, не переживает её
// закрытие (рекомендация контракта REST API). В URL токен не попадает никогда:
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

export const NETWORK_ERROR_MESSAGE = 'Нет соединения с сервером';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number, // 0 — сеть недоступна
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function networkError(): ApiRequestError {
  return new ApiRequestError(0, 'network', NETWORK_ERROR_MESSAGE);
}

/** 401: токен забываем и сообщаем приложению — оно само покажет экран входа. */
export function handleUnauthorized(): void {
  setToken(null);
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiRequestError && e.status === 401;
}

/** Текст для тоста: message сервера уже на русском и готов к показу. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message !== '' ? e.message : fallback;
}

/** Пустое тело (204, lock) → undefined; не-JSON → null. */
export function parseBody(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Ошибка из тела {"error":{"code","message"}}; тело не по контракту — общий текст. */
export function toApiError(status: number, body: unknown): ApiRequestError {
  const err = (body as Partial<ApiError> | null | undefined)?.error;
  if (err !== undefined && typeof err.code === 'string' && typeof err.message === 'string') {
    return new ApiRequestError(status, err.code, err.message);
  }
  return new ApiRequestError(status, 'internal', `Ошибка сервера (${status})`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  // сервер принимает JSON только с этим Content-Type; пустое тело — без заголовка
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  let text: string;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await res.text();
  } catch {
    throw networkError();
  }

  const data = parseBody(text);
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    throw toApiError(res.status, data);
  }
  if (data === null) {
    throw new ApiRequestError(res.status, 'bad_response', 'Некорректный ответ сервера');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
