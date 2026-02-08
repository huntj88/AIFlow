import path from 'node:path';

import { defineConfig } from 'vitest/config';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-utils/vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test-utils/**', 'src/vite-env.d.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
