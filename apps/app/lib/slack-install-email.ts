/**
 * Email the tenant admin when a customer completes the public Slack
 * install flow at `/install/slack?tenant=<slug>`. The notification
 * surfaces the new `SlackInstall` row to the tenant operator so they
 * know to configure routing, follow up with the customer, etc.
 *
 * Fire-and-forget — wrapped in try/catch by the OAuth callback so a
 * Resend outage never breaks the install. When env is unconfigured
 * the helper returns `{ ok: false, skipped: true }` and logs a warn.
 *
 * Resolution rules:
 *   - Recipient = first user with role 'admin' on the tenant's Clerk
 *     org. We don't have a tenant-level "admin email" column, so the
 *     Clerk org's primary admin is the canonical owner. Falls back to
 *     SENDERO_SUPPORT_EMAIL on lookup failure (so the install isn't
 *     dropped silently).
 *   - From / replyTo / template all match the existing
 *     security-alert-senders.ts pattern.
 */

import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

interface SlackInstallEmailInput {
  tenantId: string;
  teamName: string;
  enterpriseName?: string | null;
  installedAt: Date;
}

interface SendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  to?: string;
}

const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);

export async function sendSlackInstallReceivedEmail(
  input: SlackInstallEmailInput
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SENDERO_EMAIL_FROM ?? null;
  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: 'email_not_configured' };
  }

  const recipient = await resolveTenantAdminEmail(input.tenantId);
  if (!recipient) {
    return { ok: false, skipped: true, error: 'no_recipient' };
  }

  const teamLabel = input.enterpriseName
    ? `${input.enterpriseName} (Grid) · ${input.teamName}`
    : input.teamName;
  const subject = `New Slack install: ${teamLabel}`;
  const dashboardLink = `${APP_BASE_URL}/dashboard/channels/slack`;
  const body = [
    `One of your customers just installed Sendero into their Slack workspace.`,
    ``,
    `Workspace: ${teamLabel}`,
    `Installed: ${input.installedAt.toISOString()}`,
    ``,
    `What's next: configure routing rules + verify the bot lands in the right channels.`,
    `${dashboardLink}`,
    ``,
    `— Sendero`,
  ].join('\n');

  try {
    const { Resend } = await import('resend');
    const client = new Resend(apiKey);
    const replyTo = process.env.SENDERO_EMAIL_REPLY_TO ?? from;
    const result = await client.emails.send({
      from,
      to: [recipient],
      replyTo: replyTo ? [replyTo] : undefined,
      subject,
      text: body,
      tags: [{ name: 'surface', value: 'slack_install_received' }],
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? String(result.error), to: recipient };
    }
    return { ok: true, to: recipient };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      to: recipient,
    };
  }
}

async function resolveTenantAdminEmail(tenantId: string): Promise<string | null> {
  // 1. Find the tenant's Clerk org id.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { clerkOrgId: true },
  });
  if (!tenant?.clerkOrgId) return null;

  // 2. Ask Clerk for the org's admin members. Pick the first admin's
  //    primary email. If the lookup fails (rate limit, transient
  //    Clerk outage), fall back to support email so we don't lose the
  //    notification entirely.
  try {
    const cc = await clerkClient();
    const members = await cc.organizations.getOrganizationMembershipList({
      organizationId: tenant.clerkOrgId,
      limit: 25,
    });
    const adminMember = members.data.find(m => m.role === 'org:admin' || m.role === 'admin');
    const userId = adminMember?.publicUserData?.userId;
    if (!userId) return process.env.SENDERO_SUPPORT_EMAIL ?? null;
    const user = await cc.users.getUser(userId);
    const primaryEmailId = user.primaryEmailAddressId;
    const email = user.emailAddresses.find(e => e.id === primaryEmailId)?.emailAddress;
    return email ?? process.env.SENDERO_SUPPORT_EMAIL ?? null;
  } catch {
    return process.env.SENDERO_SUPPORT_EMAIL ?? null;
  }
}
