import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('renders the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  });
});
