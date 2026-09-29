import { expect, test } from '@playwright/test';

// Глубокий сценарий создаёт настоящий файл сейфа — включается переменной
// SAFEBOX_E2E=1 и путём SAFEBOX_E2E_PATH (куда положить тестовый сейф;
// файла там быть не должно). Нужен поднятый safeboxd с --allow-origin.
const deep = process.env.SAFEBOX_E2E === '1';
const safePath = process.env.SAFEBOX_E2E_PATH ?? '';
const PASSWORD = 'пароль123';

test('экран входа', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SafeBox' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Создать сейф' }).or(page.getByRole('button', { name: 'Войти' })),
  ).toBeVisible();
});

test('UF-1 → UF-13: создание, пустой сейф, блокировка, повторный вход', async ({ page }) => {
  test.skip(!deep || safePath === '', 'нужны SAFEBOX_E2E=1 и SAFEBOX_E2E_PATH');
  await page.goto('/');

  await page.getByRole('tab', { name: 'Создать новый' }).click();
  await page.getByLabel('Путь к новому сейфу').fill(safePath);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Создать сейф' }).click();
  await expect(page.getByText('Здесь пока пусто')).toBeVisible();

  await page.getByRole('button', { name: /Блокировка/ }).click();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

  // путь последнего сейфа подставлен (UF-2)
  await expect(page.getByLabel('Путь к сейфу')).toHaveValue(/\.safebox$/);
  await page.getByLabel('Пароль', { exact: true }).fill('неверный');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Здесь пока пусто')).toBeVisible();
});
