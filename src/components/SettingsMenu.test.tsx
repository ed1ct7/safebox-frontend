import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setToken } from '../api/client';
import { apiError, installFakeServer } from '../test/fakeServer';
import type { FakeServer } from '../test/fakeServer';
import { makeWrapper } from '../test/tags';
import { SettingsMenu } from './SettingsMenu';

// Поповер «Настройки» (UF-21): GET при открытии, PATCH по переключению.

let server: FakeServer;
let linkPreviews: boolean;

function setup(extra: Parameters<typeof installFakeServer>[0] = {}) {
  server = installFakeServer({
    'GET /api/v1/settings': () => ({ json: { linkPreviews } }),
    'PATCH /api/v1/settings': (c) => {
      linkPreviews = (c.body as { linkPreviews: boolean }).linkPreviews;
      return { json: { linkPreviews } };
    },
    ...extra,
  });
  render(<SettingsMenu className="btn" />, { wrapper: makeWrapper().Wrapper });
  return userEvent.setup();
}

const open = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Настройки' }));

const switchOf = () => screen.findByRole('switch', { name: 'Загружать предпросмотр ссылок' });

beforeEach(() => {
  setToken('t');
  linkPreviews = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('SettingsMenu', () => {
  it('закрыт по умолчанию и настроек не запрашивает', () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.callsTo('GET', '/api/v1/settings')).toHaveLength(0);
  });

  it('открывается поповером: переключатель отражает настройку, есть пояснение', async () => {
    const user = setup();
    await open(user);
    await waitFor(async () => expect(await switchOf()).toBeChecked());
    expect(
      screen.getByText('Название, описание и картинку сейф берёт со страницы — это запрос к сайту с этого компьютера.'),
    ).toBeInTheDocument();
  });

  it('выключена на сервере - переключатель снят', async () => {
    linkPreviews = false;
    const user = setup();
    await open(user);
    const toggle = await switchOf();
    await waitFor(() => expect(server.callsTo('GET', '/api/v1/settings')).toHaveLength(1));
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();
  });

  it('переключение - сразу PATCH с новым значением', async () => {
    const user = setup();
    await open(user);
    const toggle = await switchOf();
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(server.callsTo('PATCH', '/api/v1/settings').map((c) => c.body)).toEqual([{ linkPreviews: false }]);
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(server.callsTo('PATCH', '/api/v1/settings').at(-1)?.body).toEqual({ linkPreviews: true });
  });

  it('PATCH не удался - тост с причиной, переключатель остаётся как на сервере', async () => {
    const user = setup({
      'PATCH /api/v1/settings': () => apiError(500, 'internal', 'Не удалось записать настройки'),
    });
    await open(user);
    const toggle = await switchOf();
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    expect(await screen.findByText('Не удалось записать настройки')).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('настройки не прочитались - сообщение вместо переключателя', async () => {
    const user = setup({ 'GET /api/v1/settings': () => apiError(500, 'internal', 'Файл настроек повреждён') });
    await open(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Файл настроек повреждён');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Esc и клик мимо закрывают поповер', async () => {
    const user = setup();
    await open(user);
    await screen.findByRole('dialog', { name: 'Настройки' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await open(user);
    await screen.findByRole('dialog', { name: 'Настройки' });
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
