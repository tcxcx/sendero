import { createClerkClient } from '@clerk/backend';
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';
import { prisma } from '@sendero/database';

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

type InstallSnapshot = {
  install: {
    status: string;
    phoneNumberId: string | null;
    displayPhoneNumber: string | null;
    setupLinkUrl: string | null;
    setupLinkError: string | null;
    provisioned: boolean;
  } | null;
};

type SetupLinkResponse = {
  error?: string;
  message?: string;
  customerId?: string;
  setupLink?: {
    id?: string;
    url?: string;
    status?: string;
    whatsapp_setup_error?: string | null;
  };
};

const fixture = JSON.parse(await readFile(path.resolve('../../qa-logins.local.json'), 'utf8')) as {
  users: QaUser[];
};
const corporate = fixture.users.find(user => user.label === 'QA Corporate');

if (!corporate) {
  throw new Error('Expected QA Corporate fixture in qa-logins.local.json');
}

test('WhatsApp tenant provisioning creates JSON setup state and disconnect resets locally', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await mkdir(path.resolve('../../.gstack/qa-reports/screenshots'), { recursive: true });
  await clerkSetup();

  const consoleMessages: string[] = [];
  page.on('console', message => {
    const text = message.text();
    if (text.includes('[whatsapp')) {
      consoleMessages.push(`${message.type()}: ${text}`);
    }
  });

  await setupClerkTestingToken({ context: page.context() });
  await page.goto(`${baseURL}/sign-in`);
  await page.waitForFunction(() => Boolean(window.Clerk?.loaded), undefined, { timeout: 60_000 });
  await signInWithTicket(page, corporate.email);
  await page.evaluate(async orgId => {
    await window.Clerk.setActive({ organization: orgId });
  }, corporate.defaultOrg.orgId);
  await expect.poll(async () => page.evaluate(() => Boolean(window.Clerk.user))).toBe(true);

  await page.goto(`${baseURL}/dashboard/channels/whatsapp/connect`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.getByRole('main').getByText(/Connect your WhatsApp Business number through Kapso/i)
  ).toBeVisible();

  const disconnectReset = await page.evaluate(async () => {
    const response = await fetch('/api/channels/whatsapp/install', {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    return {
      status: response.status,
      contentType,
      body: (text ? JSON.parse(text) : null) as unknown,
    };
  });
  expect(disconnectReset.status, JSON.stringify(disconnectReset.body)).toBe(200);
  expect(disconnectReset.contentType).toContain('application/json');

  const emptySnapshot = await page.evaluate(async () => {
    const response = await fetch('/api/channels/whatsapp/install', {
      headers: { accept: 'application/json' },
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: (await response.json()) as InstallSnapshot,
    };
  });
  expect(emptySnapshot.status).toBe(200);
  expect(emptySnapshot.contentType).toContain('application/json');
  expect(emptySnapshot.body.install).toBeNull();

  const setupLink = await page.evaluate(async () => {
    const response = await fetch('/api/channels/whatsapp/setup-link', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const body = (text ? JSON.parse(text) : null) as SetupLinkResponse | null;
    return { status: response.status, contentType, body };
  });
  expect(setupLink.contentType).toContain('application/json');
  expect(setupLink.status, JSON.stringify(setupLink.body)).toBe(200);
  expect(setupLink.body?.setupLink?.url).toMatch(/^https?:\/\//);
  expect(setupLink.body?.setupLink?.whatsapp_setup_error).toBeNull();

  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await page.getByRole('heading', { name: /Choose setup region/i }).isVisible()) {
    const continueButton = page.getByRole('button', { name: /^Continue$/ });
    await expect(continueButton).toBeEnabled({ timeout: 30_000 });
    const resumeResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/channels/wizard/resume')
    );
    await continueButton.click();
    const resumeResponse = await resumeResponsePromise;
    const resumeText = await resumeResponse.text();
    expect(resumeResponse.status(), resumeText.slice(0, 500)).toBe(200);
  }
  await expect(page.getByRole('heading', { name: /Verify business number/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: /^Open WhatsApp setup$/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/whatsapp-tenant-pending-link.png'),
    fullPage: true,
  });

  await prisma.whatsAppInstall.update({
    where: { tenantId: corporate.defaultOrg.tenantId },
    data: {
      status: 'active',
      phoneNumberId: `qa_phone_${Date.now()}`,
      kapsoConnectionId: `qa_connection_${Date.now()}`,
      businessAccountId: 'qa_business_account',
      displayPhoneNumber: '+1 555-932-5668',
      businessDisplayName: 'QA Corporate Travel',
      lastErrorMessage: null,
      lastHealthyAt: new Date(),
    },
  });

  await page.goto(`${baseURL}/dashboard/channels/whatsapp`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
  await expect(page.getByText('+1 555-932-5668')).toBeVisible();
  await page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/whatsapp-tenant-connected.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /^Disconnect$/ }).click();
  await expect(page.getByRole('button', { name: /Disconnecting/i })).toBeVisible();
  await expect
    .poll(async () => {
      const row = await prisma.whatsAppInstall.findUnique({
        where: { tenantId: corporate.defaultOrg.tenantId },
        select: { id: true },
      });
      return row;
    })
    .toBeNull();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel(/WhatsApp channel status: Not connected/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: /Start setup/i })).toBeVisible();
  await page.screenshot({
    path: path.resolve('../../.gstack/qa-reports/screenshots/whatsapp-tenant-disconnected.png'),
    fullPage: true,
  });

  expect(consoleMessages.some(text => text.includes('[whatsapp connected panel]'))).toBe(true);
});

async function signInWithTicket(page: import('@playwright/test').Page, emailAddress: string) {
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
