import { defineConfig } from '@playwright/test';

// e2e требует поднятого safeboxd с разрешённым origin dev-сервера:
//   safeboxd --allow-origin http://localhost:5173
// По умолчанию vite dev (5173) запускается конфигом сам (или переиспользуется).
// Уже поднятый стенд на другом адресе: SAFEBOX_E2E_URL=http://localhost:5174.
const externalUrl = process.env.SAFEBOX_E2E_URL;
// Системный браузер вместо скачанного Playwright: SAFEBOX_E2E_CHANNEL=msedge (или chrome)
const channel = process.env.SAFEBOX_E2E_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: externalUrl ?? 'http://localhost:5173',
    ...(channel === undefined ? {} : { channel }),
  },
  webServer:
    externalUrl === undefined
      ? {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
        }
      : undefined,
});
