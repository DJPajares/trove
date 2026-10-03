import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next preserves JSX for its own compiler; rendered UI tests need the React
  // runtime instead when importing those same components through Vite.
  oxc: { jsx: { runtime: 'automatic' } },
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
