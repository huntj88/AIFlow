import { defineConfig, devices } from '@playwright/test';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  testDir: './e2e',
  outputDir: './playwright-report',
  reporter: 'list',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @aiflow/server run dev',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
    },
    {
      command: 'pnpm --filter @aiflow/client run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
    },
  ],
});
