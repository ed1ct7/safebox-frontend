import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest без globals не даёт RTL самому подписаться на afterEach
afterEach(() => {
  cleanup();
});
