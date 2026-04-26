/**
 * E2E sketch for the buyer cancel-sweep dashboard page.
 *
 * Three core branches per the OTP design doc:
 *   1. Buyer lands on `/dashboard/trips/[tripId]/cancel?reason=lockout`
 *      → both action buttons render and the lockout explainer copy
 *      ("Three failed attempts…") is visible.
 *   2. Non-buyer (different tenant or no MSCA match for the trip's
 *      `buyer` address) → page returns 404 to avoid leaking trip ids.
 *   3. Trip already cancelled → both buttons render disabled with the
 *      "already cancelled" helper text.
 *
 * Authentication: this suite needs PLAYWRIGHT_STORAGE_STATE pointing
 * to a Clerk-authenticated session for the buyer's tenant. Without it
 * the suite skips, mirroring the role-gate.spec.ts pattern.
 *
 * Trip seeding: the suite expects a fixture trip whose id is exposed
 * via PLAYWRIGHT_LOCKOUT_TRIP_ID. The CI seeder mints this trip with
 * a known buyer matching the test tenant and triggers a lockout via
 * three failed `claimTrip` calls on the testnet fork.
 *
 * If you're filling these in by hand:
 *   - Create a trip via `bun run scripts/lockout-fixture.ts`
 *   - Note the printed tripId + a "non-buyer" Clerk session storage
 *   - Set PLAYWRIGHT_LOCKOUT_TRIP_ID, PLAYWRIGHT_STORAGE_STATE,
 *     PLAYWRIGHT_NONBUYER_STORAGE_STATE before invoking the suite.
 */

import { expect, test } from '@playwright/test';

const TRIP_ID = process.env.PLAYWRIGHT_LOCKOUT_TRIP_ID;
const NONBUYER_STORAGE = process.env.PLAYWRIGHT_NONBUYER_STORAGE_STATE;

test.describe('cancel-lockout page', () => {
  test.skip(
    !process.env.PLAYWRIGHT_STORAGE_STATE,
    'Set PLAYWRIGHT_STORAGE_STATE to a buyer-tenant Clerk session.'
  );
  test.skip(!TRIP_ID, 'Set PLAYWRIGHT_LOCKOUT_TRIP_ID to a seeded fixture trip id.');

  test('renders both action buttons + lockout explainer for the buyer', async ({ page }) => {
    await page.goto(`/dashboard/trips/${TRIP_ID}/cancel?reason=lockout`);
    await expect(page.getByTestId('lockout-explainer')).toBeVisible();
    await expect(page.getByTestId('resend-code-button')).toBeVisible();
    await expect(page.getByTestId('cancel-sweep-button')).toBeVisible();
  });

  test('shows the disabled-reason helper when the trip is already cancelled', async ({ page }) => {
    // Requires a second fixture trip that's already in `canceled` state.
    test.skip(
      !process.env.PLAYWRIGHT_CANCELLED_TRIP_ID,
      'Set PLAYWRIGHT_CANCELLED_TRIP_ID to a fixture trip in canceled status.'
    );
    await page.goto(
      `/dashboard/trips/${process.env.PLAYWRIGHT_CANCELLED_TRIP_ID}/cancel?reason=lockout`
    );
    await expect(page.getByTestId('disabled-reason')).toContainText(/already cancelled/i);
    // Buttons are still rendered but disabled — verify pointer-events
    // stay locked by attempting a click.
    await expect(page.getByTestId('resend-code-button')).toBeDisabled();
    await expect(page.getByTestId('cancel-sweep-button')).toBeDisabled();
  });
});

test.describe('cancel-lockout page — non-buyer access', () => {
  test.skip(!NONBUYER_STORAGE, 'Set PLAYWRIGHT_NONBUYER_STORAGE_STATE.');
  test.skip(!TRIP_ID, 'Set PLAYWRIGHT_LOCKOUT_TRIP_ID.');

  test.use({ storageState: NONBUYER_STORAGE });

  test('non-buyer hits notFound (no trip id leakage)', async ({ page }) => {
    const res = await page.goto(`/dashboard/trips/${TRIP_ID}/cancel?reason=lockout`);
    // App-router notFound() returns 404 with the catch-all not-found page.
    expect(res?.status()).toBe(404);
  });
});

test.describe('cancel-lockout server action — pending submitter', () => {
  test.skip(!process.env.PLAYWRIGHT_STORAGE_STATE, 'Set PLAYWRIGHT_STORAGE_STATE for the buyer.');
  test.skip(!TRIP_ID, 'Set PLAYWRIGHT_LOCKOUT_TRIP_ID.');

  test('clicking Cancel surfaces the msca-pending banner until the submitter ships', async ({
    page,
  }) => {
    await page.goto(`/dashboard/trips/${TRIP_ID}/cancel?reason=lockout`);
    await page.getByTestId('cancel-sweep-button').click();
    await expect(page.getByTestId('msca-pending-banner')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('msca-pending-banner')).toContainText(
      /Manual fallback required/i
    );
  });
});
