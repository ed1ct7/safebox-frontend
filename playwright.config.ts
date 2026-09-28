import { defineConfig } from '@playwright/test';

// e2e требует поднятого safeboxd на 127.0.0.1:8900 с разрешённым origin:
//   safeboxd --allow-origin http://localhost:5173
// Веб-сервер (vite dev) запускается конфигом сам.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
