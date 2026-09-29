import { vi } from 'vitest';

// Подставной сервер для компонентных тестов: fetch отвечает по таблице
// «МЕТОД /путь» -> обработчик. Неизвестный запрос - 404 в формате ошибки контракта.

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (call: Call) => { status?: number; json?: unknown };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

export function apiError(status: number, code: string, message: string): ReturnType<Handler> {
  return { status, json: { error: { code, message } } };
}

export interface FakeServer {
  /** обработчики по «МЕТОД /путь»: тест может подменить или добавить свои */
  routes: Record<string, Handler>;
  calls: Call[];
  callsTo: (method: string, path: string) => Call[];
}

export function installFakeServer(routes: Record<string, Handler> = {}): FakeServer {
  const server: FakeServer = {
    routes: { ...routes },
    calls: [],
    callsTo: (method, path) => server.calls.filter((c) => c.method === method && c.path === path),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      server.calls.push(call);
      const handler = server.routes[`${call.method} ${call.path}`];
      if (handler === undefined) {
        const r = apiError(404, 'not_found', `нет ${call.method} ${call.path}`);
        return json(r.json, r.status);
      }
      const r = handler(call);
      return json(r.json ?? {}, r.status);
    }),
  );
  return server;
}
