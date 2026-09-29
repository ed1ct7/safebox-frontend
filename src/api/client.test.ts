import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, getToken, setToken, UNAUTHORIZED_EVENT } from './client';

function respond(status: number, body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(status === 204 ? null : body, { status })),
  );
}

describe('api client', () => {
  beforeEach(() => setToken('t-123'));
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });

  it('шлёт Bearer и JSON только когда есть тело', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/api/v1/safe/heartbeat', { active: true });
    await api.post('/api/v1/safe/lock');
    const [, withBody] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, noBody] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(withBody.headers).toEqual({
      Authorization: 'Bearer t-123',
      'Content-Type': 'application/json',
    });
    expect(noBody.headers).toEqual({ Authorization: 'Bearer t-123' });
  });

  it('204 и пустое 200 — не ошибка', async () => {
    respond(204, '');
    await expect(api.post('/api/v1/safe/lock')).resolves.toBeUndefined();
    respond(200, '');
    await expect(api.post('/api/v1/safe/password', {})).resolves.toBeUndefined();
  });

  it('ошибка сервера: код и русский message из тела', async () => {
    respond(403, '{"error":{"code":"wrong_password","message":"Неверный пароль"}}');
    const err = await api.post('/api/v1/safe/unlock', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 403, code: 'wrong_password', message: 'Неверный пароль' });
    expect(getToken()).toBe('t-123'); // неверный пароль — не повод выходить
  });

  it('тело ошибки не JSON — общий текст', async () => {
    respond(502, '<html>Bad Gateway</html>');
    await expect(api.get('/api/v1/entries')).rejects.toMatchObject({
      status: 502,
      message: 'Ошибка сервера (502)',
    });
  });

  it('401: токен стирается и приложение уходит на экран входа', async () => {
    respond(401, '{"error":{"code":"unauthorized","message":"Требуется вход в сейф"}}');
    const onUnauthorized = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    await expect(api.get('/api/v1/entries')).rejects.toMatchObject({ status: 401 });
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
  });

  it('сеть недоступна — code network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api.get('/api/v1/safe/status')).rejects.toMatchObject({
      status: 0,
      code: 'network',
      message: 'Нет соединения с сервером',
    });
  });

  it('успешный ответ не JSON — внятная ошибка вместо падения', async () => {
    respond(200, 'not json');
    await expect(api.get('/api/v1/entries')).rejects.toMatchObject({ code: 'bad_response' });
  });
});
