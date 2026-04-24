import { expect, test } from '@playwright/test';

test.describe('authenticated prefund flows', () => {
  test.skip(
    !process.env.PLAYWRIGHT_STORAGE_STATE,
    'Set PLAYWRIGHT_STORAGE_STATE for authenticated E2E.'
  );

  test('prefund a new trip via the sheet', async ({ page }) => {
    await page.goto('/dashboard/trips');
    await page.getByRole('link', { name: 'Create prepaid trip' }).click();
    await expect(page).toHaveURL(/\?sheet=new/);
    await page.getByLabel('Budget (USDC)').fill('100');
    await page.getByLabel('Traveler email').fill('test@example.com');
    await page.getByLabel('Traveler name').fill('Test Traveler');
    await page.getByRole('button', { name: 'Create claim link' }).click();
    await expect(page.getByText('Invite created')).toBeVisible();
  });
});
