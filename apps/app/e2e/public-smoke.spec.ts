import { expect, test, type Page } from '@playwright/test';

async function expectNoFrameworkOverlay(page: Page) {
  await expect(
    page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')
  ).toHaveCount(0);
}

test.describe('public product smoke', () => {
  test('landing explains the agent platform and exposes access paths', async ({ page }) => {
    await page.goto('/');

    await expectNoFrameworkOverlay(page);
    await expect(
      page.getByRole('heading', { name: /AI travel agents that live where your customers/i })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Request access/i }).first()).toHaveAttribute(
      'href',
      '/waitlist'
    );
    await expect(page.getByRole('link', { name: /Read llms\.txt/i }).first()).toHaveAttribute(
      'href',
      '/llms.txt'
    );
    await expect(
      page.getByRole('heading', { name: /Connect operators and travelers/i })
    ).toBeVisible();
    await expect(page.getByText(/WhatsApp traveler/i)).toBeVisible();
    await expect(page.getByText(/Corporate Slack/i)).toBeVisible();
  });

  test('llms.txt stays public and agent-readable', async ({ page }) => {
    await page.goto('/llms.txt');

    await expectNoFrameworkOverlay(page);
    await expect(page.locator('body')).toContainText('# Sendero App');
    await expect(page.locator('body')).toContainText('MCP tools');
    await expect(page.locator('body')).toContainText('Arc testnet settlement');
  });

  test('protected workspace redirects into the Clerk-managed sign-in shell', async ({ page }) => {
    await page.goto('/app');

    await expectNoFrameworkOverlay(page);
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=/);
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByText(/Protected routes stay behind Clerk/i)).toBeVisible();
    await expect(
      page
        .getByPlaceholder(/email/i)
        .or(page.getByText(/Clerk connection delayed/i))
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('login shell persists selected locale through proxy middleware', async ({ page }) => {
    await page.goto('/sign-in?sendero_locale=es-AR');

    await expectNoFrameworkOverlay(page);
    await expect(page).toHaveURL(/\/sign-in(?:$|\?)/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-AR');
    await expect(page.getByRole('heading', { name: /Volvé a entrar/i })).toBeVisible();
    await expect(page.getByLabel(/Language/i)).toHaveValue('es-AR');
  });

  test('waitlist route never renders a blank Clerk panel', async ({ page }) => {
    await page.goto('/waitlist');

    await expectNoFrameworkOverlay(page);
    await expect(
      page.getByRole('heading', { name: /Join the Sendero agent network/i })
    ).toBeVisible();

    const clerkEmail = page.getByPlaceholder(/email/i);
    const clerkRecoveryState = page.getByText(/Clerk connection delayed/i);

    await expect(clerkEmail.or(clerkRecoveryState).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
