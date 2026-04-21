import { expect, test } from '@playwright/test';

test.describe('authenticated invoice flows', () => {
  test.skip(
    !process.env.PLAYWRIGHT_STORAGE_STATE,
    'Set PLAYWRIGHT_STORAGE_STATE for authenticated E2E.'
  );

  test('invoice detail exposes a PDF download action', async ({ page }) => {
    await page.goto('/app/billing/invoices');
    const firstInvoice = page
      .getByRole('link')
      .filter({ hasText: /INV|SND|PLAT/i })
      .first();
    await expect(firstInvoice).toBeVisible();
    await firstInvoice.click();
    await expect(page.getByRole('button', { name: /Download PDF/i })).toBeVisible();
  });
});
