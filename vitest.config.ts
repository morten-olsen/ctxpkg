import { defineConfig } from 'vitest/config';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['tests/**', 'src/**/*.test.ts'],
    },
    // Increase timeout for embedding operations
    testTimeout: 120000,
    // Tests can run in parallel since each uses in-memory database
  },
  resolve: {
    alias: {
      '#root': new URL('./src', import.meta.url).pathname,
    },
  },
});
