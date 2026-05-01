import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

type QaOrg = {
  orgId: string;
  tenantId: string;
};

type QaUser = {
  label: string;
  email: string;
  defaultOrg: QaOrg;
};

const fixture = JSON.parse(await readFile(path.resolve('../../qa-logins.local.json'), 'utf8')) as {
  users: QaUser[];
};
const userByLabel = new Map(fixture.users.map(user => [user.label, user]));

const corporate = userByLabel.get('QA Corporate');
const dogfood = userByLabel.get('Sendero Dogfood');
const agency = userByLabel.get('QA Agency');

if (!corporate || !dogfood || !agency) {
  throw new Error('Expected QA Corporate, Sendero Dogfood, and QA Agency fixtures');
}

test('Liveblocks accepts same-org collaborators and rejects cross-org access', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await mkdir(path.resolve('../../.gstack/qa-reports/screenshots'), { recursive: true });
  await clerkSetup();

  async function signIn(label: string, user: QaUser) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${baseURL}/sign-in`);
    await clerk.signIn({ page, emailAddress: user.email });
    await page.evaluate(async orgId => {
      await window.Clerk.setActive({ organization: orgId });
    }, user.defaultOrg.orgId);
    const signedIn = await page.evaluate(() => Boolean(window.Clerk.user));
    if (!signedIn) {
      await page.screenshot({
        path: path.resolve(
          `../../.gstack/qa-reports/screenshots/liveblocks-${label}-signin-blocked.png`
        ),
        fullPage: true,
      });
    }

    expect(signedIn, `${label} should have a Clerk user after test sign-in`).toBe(true);
    return { context, page };
  }

  async function authLiveblocks(page: import('@playwright/test').Page, roomId: string) {
    return page.evaluate(async room => {
      const response = await fetch('/api/liveblocks-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      return {
        status: response.status,
        body: (await response.text()).slice(0, 200),
      };
    }, roomId);
  }

  async function createQaTrip(page: import('@playwright/test').Page, label: string) {
    return page.evaluate(async qaLabel => {
      const response = await fetch('/api/trips/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `Liveblocks QA ${qaLabel}`,
          intent: {
            destination: 'Mexico City',
            purpose: 'Liveblocks trip-room QA',
            departureDate: '2026-05-05',
            returnDate: '2026-05-09',
          },
          metadata: {
            qa: true,
            qaFlow: 'liveblocks-two-session',
          },
        }),
      });
      return {
        status: response.status,
        body: (await response.json()) as { tripId?: string; href?: string; error?: string },
      };
    }, label);
  }

  const corporateSession = await signIn('corporate', corporate);
  const dogfoodSession = await signIn('dogfood', dogfood);
  const agencySession = await signIn('agency', agency);

  const corporateRoomId = `sendero:${corporate.defaultOrg.tenantId}:workspace`;
  const agencyRoomId = `sendero:${agency.defaultOrg.tenantId}:workspace`;

  const corporateTrip = await createQaTrip(corporateSession.page, 'corporate');
  expect(corporateTrip.status, JSON.stringify(corporateTrip.body)).toBe(200);
  expect(corporateTrip.body.tripId).toBeTruthy();
  const agencyTrip = await createQaTrip(agencySession.page, 'agency');
  expect(agencyTrip.status, JSON.stringify(agencyTrip.body)).toBe(200);
  expect(agencyTrip.body.tripId).toBeTruthy();

  const corporateTripId = corporateTrip.body.tripId!;
  const agencyTripId = agencyTrip.body.tripId!;
  const corporateTripRoomId = `sendero:${corporate.defaultOrg.tenantId}:trip:${corporateTripId}`;
  const agencyTripRoomId = `sendero:${agency.defaultOrg.tenantId}:trip:${agencyTripId}`;

  await expect
    .poll(async () => (await authLiveblocks(corporateSession.page, corporateRoomId)).status)
    .toBe(200);
  await expect
    .poll(async () => (await authLiveblocks(dogfoodSession.page, corporateRoomId)).status)
    .toBe(200);
  await expect
    .poll(async () => (await authLiveblocks(agencySession.page, corporateRoomId)).status)
    .toBe(403);
  await expect
    .poll(async () => (await authLiveblocks(corporateSession.page, agencyRoomId)).status)
    .toBe(403);
  await expect
    .poll(async () => (await authLiveblocks(corporateSession.page, corporateTripRoomId)).status)
    .toBe(200);
  await expect
    .poll(async () => (await authLiveblocks(dogfoodSession.page, corporateTripRoomId)).status)
    .toBe(200);
  await expect
    .poll(async () => (await authLiveblocks(agencySession.page, corporateTripRoomId)).status)
    .toBe(403);
  await expect
    .poll(async () => (await authLiveblocks(corporateSession.page, agencyTripRoomId)).status)
    .toBe(403);

  await corporateSession.page.goto(`${baseURL}/dashboard/console`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await dogfoodSession.page.goto(`${baseURL}/dashboard/console`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await Promise.all([
    corporateSession.page.waitForLoadState('domcontentloaded').catch(() => undefined),
    dogfoodSession.page.waitForLoadState('domcontentloaded').catch(() => undefined),
  ]);

  await corporateSession.page.mouse.move(260, 220);
  await dogfoodSession.page.mouse.move(760, 360);
  await corporateSession.page.waitForTimeout(1000);
  await corporateSession.page.mouse.move(320, 260);
  await dogfoodSession.page.mouse.move(820, 420);

  await expect(
    corporateSession.page.getByLabel(/Sendero Dogfood, admin collaborator/i)
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(dogfoodSession.page.getByLabel(/QA Corporate, admin collaborator/i)).toBeVisible({
    timeout: 20_000,
  });

  await corporateSession.page.getByRole('button', { name: /notifications/i }).click();
  await expect(corporateSession.page.locator('body')).toContainText(/Liveblocks notifications/i, {
    timeout: 10_000,
  });
  await expect(corporateSession.page.locator('body')).toContainText(/Route inbox/i);

  await corporateSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-corporate-dashboard.png'),
    fullPage: true,
  });
  await dogfoodSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-dogfood-dashboard.png'),
    fullPage: true,
  });

  await expect(corporateSession.page.locator('body')).toContainText(/Sendero|dashboard|workspace/i);
  await expect(dogfoodSession.page.locator('body')).toContainText(/Sendero|dashboard|workspace/i);

  await corporateSession.page.goto(`${baseURL}/dashboard/trips/${corporateTripId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await dogfoodSession.page.goto(`${baseURL}/dashboard/trips/${corporateTripId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await corporateSession.page.mouse.move(420, 360);
  await dogfoodSession.page.mouse.move(760, 460);

  const corporateTripCollaborators = corporateSession.page.getByRole('complementary', {
    name: /Trip collaborators/i,
  });

  await expect(
    corporateTripCollaborators.getByLabel(/Sendero Dogfood, admin collaborator/i)
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(corporateSession.page.locator('body')).toContainText(/Trip collaborators/i);
  await expect(corporateSession.page.locator('body')).toContainText(
    /trip workspace|reviewing bookings/i
  );

  await corporateSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-corporate-trip-detail.png'),
    fullPage: true,
  });
  await dogfoodSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-dogfood-trip-detail.png'),
    fullPage: true,
  });

  await Promise.all([
    corporateSession.page.goto(`${baseURL}/dashboard/inbox/${corporateTripId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    }),
    dogfoodSession.page.goto(`${baseURL}/dashboard/inbox/${corporateTripId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    }),
  ]);
  await expect(corporateSession.page.locator('body')).toContainText(/Trip inbox/i);
  await expect(dogfoodSession.page.locator('body')).toContainText(/Trip inbox/i);
  await corporateSession.page.waitForTimeout(1500);
  await corporateSession.page.mouse.move(500, 360);
  await dogfoodSession.page.mouse.move(780, 420);
  await corporateSession.page.waitForTimeout(1000);

  const corporateTripInboxCollaborators = corporateSession.page.getByRole('complementary', {
    name: /Trip collaborators/i,
  });

  await expect(
    corporateTripInboxCollaborators.getByLabel(/Sendero Dogfood, admin collaborator/i)
  ).toBeVisible({ timeout: 30_000 });
  await expect(corporateTripInboxCollaborators).toContainText(/support handoff/i);

  await corporateSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-corporate-trip-inbox.png'),
    fullPage: true,
  });
  await dogfoodSession.page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/liveblocks-dogfood-trip-inbox.png'),
    fullPage: true,
  });

  await corporateSession.context.close();
  await dogfoodSession.context.close();
  await agencySession.context.close();
});
