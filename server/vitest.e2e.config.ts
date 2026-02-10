/**
 * Vitest configuration for server E2E tests (Task 34).
 *
 * Runs only __e2e__ test files with extended timeouts to accommodate
 * full machine lifecycle scenarios (start → poll → complete).
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    include: ['src/__e2e__/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
