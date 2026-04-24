import { expect, test } from '@playwright/test';

test.describe('authenticated settings flows', () => {
  test.skip(
    !process.env.PLAYWRIGHT_STORAGE_STATE,
    'Set PLAYWRIGHT_STORAGE_STATE for authenticated E2E.'
  );

  test('billing settings form can be submitted', async ({ page }) => {
    await page.goto('/dashboard/settings/billing');
    await page.getByLabel('Legal name').fill('Sendero Test Buyer');
    await page.getByRole('button', { name: 'Save billing' }).click();
    await expect(page.getByLabel('Legal name')).toHaveValue('Sendero Test Buyer');
  });
});
