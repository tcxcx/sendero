import { createClerkClient } from '@clerk/backend';
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { prisma } from '@sendero/database';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

type QaUser = {
  label: string;
  email: string;
  defaultOrg: {
    orgId: string;
    tenantId: string;
  };
};

const fixture = JSON.parse(await readFile(path.resolve('../../qa-logins.local.json'), 'utf8')) as {
  users: QaUser[];
};

const corporate = requireQaUser('QA Corporate');
const agency = requireQaUser('QA Agency');

test('WhatsApp sandbox can be rebound between QA tenants and completes the wizard', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await clerkSetup();

  const corpPage = await signedInPage(browser, baseURL!, corporate);
  await resetWhatsAppInstall(corpPage);
  await bindSandbox(corpPage);
  await expect(corpPage.getByText(/Sandbox ready/i).first()).toBeVisible({ timeout: 30_000 });
  await corpPage.getByRole('button', { name: /^Continue$/ }).click();
  await expect(corpPage.getByRole('heading', { name: /Send test/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(corpPage.getByText(/Sandbox is already bound/i)).toBeVisible();

  const corpInstall = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: corporate.defaultOrg.tenantId },
    select: { status: true, phoneNumberId: true, metadata: true },
  });
  expect(corpInstall?.status).toBe('active');
  expect(corpInstall?.metadata).toMatchObject({ sandbox: true });

  const agencyPage = await signedInPage(browser, baseURL!, agency);
  await resetWhatsAppInstall(agencyPage);
  await bindSandbox(agencyPage);

  const [corpAfter, agencyInstall] = await Promise.all([
    prisma.whatsAppInstall.findUnique({
      where: { tenantId: corporate.defaultOrg.tenantId },
      select: { status: true, phoneNumberId: true },
    }),
    prisma.whatsAppInstall.findUnique({
      where: { tenantId: agency.defaultOrg.tenantId },
      select: { status: true, phoneNumberId: true, metadata: true },
    }),
  ]);

  expect(corpAfter?.status).toBe('disabled');
  expect(corpAfter?.phoneNumberId).toBeNull();
  expect(agencyInstall?.status).toBe('active');
  expect(agencyInstall?.metadata).toMatchObject({ sandbox: true });
});

function requireQaUser(label: string): QaUser {
  const user = fixture.users.find(candidate => candidate.label === label);
  if (!user) throw new Error(`Expected ${label} fixture in qa-logins.local.json`);
  return user;
}

async function signedInPage(browser: Browser, baseURL: string, user: QaUser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setupClerkTestingToken({ context });
  await page.goto(`${baseURL}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.Clerk?.loaded), undefined, { timeout: 60_000 });
  await signInWithTicket(page, user.email);
  await page.evaluate(async orgId => {
    await window.Clerk.setActive({ organization: orgId });
  }, user.defaultOrg.orgId);
  await expect.poll(async () => page.evaluate(() => Boolean(window.Clerk.user))).toBe(true);
  return page;
}

async function resetWhatsAppInstall(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/channels/whatsapp/install', {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });
    return { status: response.status, body: await response.text() };
  });
  expect(result.status, result.body).toBe(200);
}

async function bindSandbox(page: Page) {
  await page.goto('/dashboard/channels/whatsapp/connect', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Connect WhatsApp/i })).toBeVisible({
    timeout: 30_000,
  });
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/channels/whatsapp/sandbox', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    return { status: res.status, body: await res.json() };
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function signInWithTicket(page: Page, emailAddress: string) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is required for Clerk ticket sign-in');

  const clerkClient = createClerkClient({ secretKey });
  const users = await clerkClient.users.getUserList({ emailAddress: [emailAddress] });
  const user = users.data[0];
  if (!user) throw new Error(`No Clerk user found for ${emailAddress}`);
  const ticket = await clerkClient.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 300,
  });

  await page.evaluate(async signInTicket => {
    const signIn = await window.Clerk.client.signIn.create({
      strategy: 'ticket',
      ticket: signInTicket,
    });
    if (signIn.status !== 'complete' || !signIn.createdSessionId) {
      throw new Error(`Ticket sign-in failed with status ${signIn.status}`);
    }
    await window.Clerk.setActive({ session: signIn.createdSessionId });
  }, ticket.token);
}
