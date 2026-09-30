import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installFakeServer } from '../test/fakeServer';
import { loadRecentSafes, rememberSafe } from '../lib/recentSafes';
import { LoginScreen } from './LoginScreen';
import { ToastProvider } from './Toasts';

// Экран входа (UF-2): список последних сейфов - из localStorage и от сервера,
// клик подставляет путь, вход/создание запоминает сейф.

const LAST = 'C:\\Сейфы\\последний.safebox';
const SAFE = { path: LAST, entryCount: 0, idleRemainingSec: 900 };

beforeEach(() => {
  localStorage.clear();
  installFakeServer({
    'GET /api/v1/safe/status': () => ({
      json: { unlocked: true, authorized: false, lastPath: LAST, defaultDirectory: 'C:\\' },
    }),
    'POST /api/v1/safe/unlock': () => ({ json: { token: 't', safe: SAFE } }),
    'POST /api/v1/safe/create': () => ({ json: { token: 't', safe: SAFE } }),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function renderLogin() {
  const onSession = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <LoginScreen onSession={onSession} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Путь к сейфу');
  return { onSession, user: userEvent.setup() };
}

function recentsList() {
  return screen.getByRole('list', { name: 'Последние сейфы' });
}

describe('LoginScreen: последние сейфы', () => {
  it('показывает историю и последний сейф сервера (он - первым, и в поле)', async () => {
    rememberSafe('C:\\другой.safebox');
    await renderLogin();
    await screen.findByRole('button', { name: /^последний\.safebox/ }); // статус пришёл - последний первым
    const rows = within(recentsList()).getAllByRole('button', { name: /^(?!Убрать)/ }); // строки, не крестики
    expect(rows.map((r) => r.textContent)).toEqual([
      '🗄последний.safeboxC:\\Сейфы\\последний.safebox',
      '🗄другой.safeboxC:\\другой.safebox',
    ]);
    expect(screen.getByLabelText('Путь к сейфу')).toHaveValue(LAST);
  });

  it('клик по сейфу подставляет путь и фокусирует пароль', async () => {
    rememberSafe('C:\\другой.safebox');
    const { user } = await renderLogin();
    await user.click(within(recentsList()).getByRole('button', { name: /^другой\.safebox/ }));
    expect(screen.getByLabelText('Путь к сейфу')).toHaveValue('C:\\другой.safebox');
    expect(screen.getByLabelText('Пароль', { exact: true })).toHaveFocus();
  });

  it('✕ убирает сейф из списка и хранилища', async () => {
    rememberSafe('C:\\другой.safebox');
    const { user } = await renderLogin();
    await user.click(screen.getByRole('button', { name: 'Убрать «C:\\другой.safebox» из списка' }));
    expect(within(recentsList()).queryByText('другой.safebox')).toBeNull();
    expect(loadRecentSafes()).not.toContain('C:\\другой.safebox');
    expect(screen.getByLabelText('Путь к сейфу')).toHaveValue(LAST); // поле ввода ✕ не трогает
  });

  it('успешный вход запоминает сейф', async () => {
    const { user, onSession } = await renderLogin();
    await user.type(screen.getByLabelText('Пароль', { exact: true }), 'пароль123');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledOnce());
    expect(loadRecentSafes()[0]).toBe(LAST);
  });

  it('создание нового сейфа тоже попадает в историю', async () => {
    const { user, onSession } = await renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Создать новый' }));
    await user.type(screen.getByLabelText('Путь к новому сейфу'), 'C:\\новый.safebox');
    await user.type(screen.getByLabelText('Пароль', { exact: true }), 'пароль123');
    await user.type(screen.getByLabelText('Повторите пароль'), 'пароль123');
    await user.click(screen.getByRole('button', { name: 'Создать сейф' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledOnce());
    expect(loadRecentSafes()[0]).toBe('C:\\новый.safebox');
  });

  it('без истории и последнего сейфа списка нет, вкладка «Создать» активна', async () => {
    installFakeServer({
      'GET /api/v1/safe/status': () => ({
        json: { unlocked: false, authorized: false, lastPath: null, defaultDirectory: 'C:\\' },
      }),
    });
    const { user } = await renderLogin();
    await screen.findByLabelText('Путь к новому сейфу'); // статус пришёл - вкладка сменилась
    expect(user).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Последние сейфы' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Создать новый' })).toHaveAttribute('aria-selected', 'true');
  });
});
