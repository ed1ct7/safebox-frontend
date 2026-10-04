import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setToken } from '../api/client';
import { apiError, installFakeServer } from '../test/fakeServer';
import type { FakeServer } from '../test/fakeServer';
import { makeWrapper } from '../test/tags';
import { SettingsMenu } from './SettingsMenu';

// Поповер «Настройки» (UF-21): настройки читаются при старте, PATCH по переключению -
// частичный, только с изменённым полем.

let server: FakeServer;
let linkPreviews: boolean;
let tagLanguage: 'ru' | 'en' | undefined; // undefined - старый сервер без tagLanguage

function setup(extra: Parameters<typeof installFakeServer>[0] = {}) {
  server = installFakeServer({
    'GET /api/v1/settings': () => ({ json: { linkPreviews, ...(tagLanguage === undefined ? {} : { tagLanguage }) } }),
    'PATCH /api/v1/settings': (c) => {
      const patch = c.body as { linkPreviews?: boolean; tagLanguage?: 'ru' | 'en' };
      if (patch.linkPreviews !== undefined) linkPreviews = patch.linkPreviews;
      if (patch.tagLanguage !== undefined) tagLanguage = patch.tagLanguage;
      return { json: { linkPreviews, tagLanguage: tagLanguage ?? 'ru' } };
    },
    ...extra,
  });
  render(<SettingsMenu className="btn" />, { wrapper: makeWrapper().Wrapper });
  return userEvent.setup();
}

const open = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Настройки' }));

const switchOf = () => screen.findByRole('switch', { name: 'Загружать предпросмотр ссылок' });
const languageOf = (name: 'Русский' | 'English') => screen.findByRole('radio', { name });

beforeEach(() => {
  setToken('t');
  linkPreviews = true;
  tagLanguage = 'ru';
});
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('SettingsMenu: язык тегов', () => {
  it('«Язык тегов: Русский / English» отражает настройку сервера', async () => {
    tagLanguage = 'en';
    const user = setup();
    await open(user);
    expect(screen.getByRole('radiogroup', { name: 'Язык тегов' })).toBeInTheDocument();
    await waitFor(async () => expect(await languageOf('English')).toBeChecked());
    expect(await languageOf('Русский')).not.toBeChecked();
  });

  it('старый сервер без tagLanguage - русский', async () => {
    tagLanguage = undefined;
    const user = setup();
    await open(user);
    await waitFor(async () => expect(await languageOf('Русский')).toBeChecked());
    expect(await languageOf('English')).not.toBeChecked();
  });

  it('выбор English - PATCH ровно с { tagLanguage: "en" }', async () => {
    const user = setup();
    await open(user);
    const english = await languageOf('English');
    await waitFor(() => expect(english).not.toBeDisabled());
    await user.click(english);
    await waitFor(() => expect(english).toBeChecked());
    expect(server.callsTo('PATCH', '/api/v1/settings').map((c) => c.body)).toEqual([{ tagLanguage: 'en' }]);
    expect(await languageOf('Русский')).not.toBeChecked();

    await user.click(await languageOf('Русский'));
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/settings')).toHaveLength(2));
    expect(server.callsTo('PATCH', '/api/v1/settings').at(-1)?.body).toEqual({ tagLanguage: 'ru' });
  });

  it('уже выбранный язык запроса не шлёт', async () => {
    const user = setup();
    await open(user);
    const russian = await languageOf('Русский');
    await waitFor(() => expect(russian).not.toBeDisabled());
    await user.click(russian);
    expect(server.callsTo('PATCH', '/api/v1/settings')).toHaveLength(0);
  });

  it('PATCH не удался - тост с причиной, язык остаётся как на сервере', async () => {
    const user = setup({
      'PATCH /api/v1/settings': () => apiError(500, 'internal', 'Не удалось записать настройки'),
    });
    await open(user);
    const english = await languageOf('English');
    await waitFor(() => expect(english).not.toBeDisabled());
    await user.click(english);
    expect(await screen.findByText('Не удалось записать настройки')).toBeInTheDocument();
    await waitFor(() => expect(english).not.toBeChecked());
    expect(await languageOf('Русский')).toBeChecked();
  });
});

describe('SettingsMenu', () => {
  it('закрыт по умолчанию; настройки читаются при старте (их ждёт каталог тегов), а не при открытии', async () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(server.callsTo('GET', '/api/v1/settings')).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('переключатель настройки не трогает язык тегов: PATCH только с linkPreviews', async () => {
    tagLanguage = 'en';
    const user = setup();
    await open(user);
    await waitFor(async () => expect(await switchOf()).toBeChecked());
    await user.click(await switchOf());
    await waitFor(() => expect(server.callsTo('PATCH', '/api/v1/settings')).toHaveLength(1));
    expect(server.callsTo('PATCH', '/api/v1/settings')[0]?.body).toEqual({ linkPreviews: false });
    expect(await languageOf('English')).toBeChecked();
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
