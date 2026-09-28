import { expect, test } from '@playwright/test';

// Глубокий сценарий создаёт настоящий файл сейфа — включается переменной
// SAFEBOX_E2E=1 и путём SAFEBOX_E2E_PATH (куда положить тестовый сейф).
const deep = process.env.SAFEBOX_E2E === '1';
const safePath = process.env.SAFEBOX_E2E_PATH ?? '';

test('экран входа', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('SafeBox')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать сейф' }).or(page.getByRole('button', { name: 'Войти' }))).toBeVisible();
});

test('создание сейфа и пустое состояние', async ({ page }) => {
  test.skip(!deep || safePath === '', 'нужны SAFEBOX_E2E=1 и SAFEBOX_E2E_PATH');
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать новый' }).click();
  await page.getByPlaceholder(/Мой сейф/).fill(safePath);
  await page.getByPlaceholder('Пароль', { exact: true }).locator('visible=true').first().fill('пароль123');
  await page.getByPlaceholder('Повторите новый').fill('пароль123');
  await page.getByRole('button', { name: 'Создать сейф' }).click();
  await expect(page.getByText('Здесь пока пусто')).toBeVisible();
});
