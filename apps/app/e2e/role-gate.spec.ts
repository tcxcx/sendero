import { expect, test } from '@playwright/test';

test.describe('authenticated role gates', () => {
  test.skip(
    !process.env.PLAYWRIGHT_STORAGE_STATE,
    'Set PLAYWRIGHT_STORAGE_STATE for authenticated E2E.'
  );

  test('protected app shell loads for authenticated users', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /Trips/i })).toBeVisible();
  });
});
