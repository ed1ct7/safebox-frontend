/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Где слушает safeboxd в dev. Другой порт/второй экземпляр (например, для e2e):
//   SAFEBOX_API=http://127.0.0.1:8901 npm run dev -- --port 5174
const apiTarget = process.env.SAFEBOX_API ?? 'http://127.0.0.1:8900';

// changeOrigin обязателен: safeboxd пускает только Host 127.0.0.1:<порт> / localhost:<порт>
// (docs/api.md бэкенда, «Общее»). Origin при этом остаётся dev-сервера —
// его safeboxd должен разрешить: --allow-origin http://localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
