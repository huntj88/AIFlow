import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('renders the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  });

  test('hello button fetches and displays server response', async ({ page }) => {
    await page.goto('/');

    const button = page.getByRole('button', { name: /hello/i });
    await expect(button).toBeVisible();
    await button.click();

    const response = page.getByTestId('hello-response');
    await expect(response).toBeVisible({ timeout: 5000 });
    await expect(response).toContainText('hello world');
  });
});
