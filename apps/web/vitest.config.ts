import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The same `@/` root the app compiles against, so a test can import any
    // module the app can rather than only the alias-free ones.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
