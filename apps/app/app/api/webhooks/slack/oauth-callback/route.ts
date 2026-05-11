/**
 * Slack OAuth callback.
 *
 * Receives `code` + `state` after the user approves the install, swaps
 * for a bot token, and persists a SlackInstall row. Enterprise Grid is
 * fully supported — installs spanning multiple workspaces resolve to a
 * single (enterpriseId, teamId) record.
 *
 * `state` is HMAC-signed (see `lib/slack-oauth-state.ts`) and carries
 * the initiating tenantId plus a 10-minute expiry. Unsigned / expired
 * state is rejected before any DB lookup so a forged state can't bind
 * a victim's Slack workspace to an attacker's tenant.
 */

import { after, type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { createSlackClient, exchangeCode, postMessage } from '@sendero/slack';

import { sendSlackInstallReceivedEmail } from '@/lib/slack-install-email';
import { type SlackStateVerifyResult, verifySlackState } from '@/lib/slack-oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = env.slackClientId();
  const clientSecret = env.slackClientSecret();
  const redirectUri = env.slackRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: 'slack_not_configured',
        message:
          'SLACK_CLIENT_ID + SLACK_CLIENT_SECRET + SLACK_REDIRECT_URI required for the install flow.',
      },
      { status: 503 }
    );
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const verified: SlackStateVerifyResult = verifySlackState(state);
  if (verified.ok !== true) {
    return NextResponse.json({ error: 'invalid_state', reason: verified.reason }, { status: 400 });
  }
  const tenantId = verified.tenantId;

  const tenantExists = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, displayName: true },
  });
  if (!tenantExists) {
    return NextResponse.json({ error: 'unknown_tenant' }, { status: 404 });
  }
  const flow = verified.flow;
  const kind = verified.kind;
  const customerAccountId = verified.customerAccountId;

  // Flow B (B2B2B corporate-customer install): verify the customer
  // account row still exists + belongs to this tenant. Belt + braces:
  // the signed state already encodes both ids, but the row could have
  // been deleted between invite mint and OAuth completion.
  let customerAccount: { id: string; displayName: string } | null = null;
  if (kind === 'customer_account' && customerAccountId) {
    const row = await prisma.customerAccount.findFirst({
      where: { id: customerAccountId, tenantId },
      select: { id: true, displayName: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'unknown_customer_account' }, { status: 404 });
    }
    customerAccount = row;
  }

  try {
    const install = await exchangeCode({
      clientId,
      clientSecret,
      redirectUri,
      code,
    });

    await prisma.slackInstall.upsert({
      where: {
        enterpriseId_teamId: {
          enterpriseId: install.enterpriseId ?? '',
          teamId: install.teamId,
        },
      },
      create: {
        tenantId,
        kind,
        customerAccountId: customerAccount?.id ?? null,
        enterpriseId: install.enterpriseId,
        enterpriseName: install.enterpriseName,
        teamId: install.teamId,
        teamName: install.teamName,
        appId: install.appId,
        botUserId: install.botUserId,
        botToken: install.botToken,
        scope: install.scope,
        isEnterpriseInstall: install.isEnterpriseInstall,
        authedUserId: install.authedUserId,
        raw: install.raw as object,
      },
      update: {
        tenantId,
        kind,
        customerAccountId: customerAccount?.id ?? null,
        botToken: install.botToken,
        scope: install.scope,
        enterpriseName: install.enterpriseName,
        teamName: install.teamName,
        isEnterpriseInstall: install.isEnterpriseInstall,
        raw: install.raw as object,
        // Reinstall after revocation: clear the marker so the events
        // route stops dropping inbound traffic.
        revokedAt: null,
      },
    });

    // Flow B post-install: flip the CustomerAccount status to 'active'
    // so the dashboard reflects the live binding, and fire a welcome
    // DM to the corporate admin who just installed. Both done in
    // after() so the redirect lands instantly.
    if (kind === 'customer_account' && customerAccount) {
      after(async () => {
        try {
          await prisma.customerAccount.update({
            where: { id: customerAccount.id },
            data: { status: 'active' },
          });
        } catch (err) {
          console.warn('[slack/oauth] customer-account activate failed', err);
        }
        try {
          await sendWelcomeDm({
            botToken: install.botToken,
            installerSlackUserId: install.authedUserId,
            tmcDisplayName: tenantExists.displayName ?? tenantExists.slug,
            customerDisplayName: customerAccount.displayName,
          });
        } catch (err) {
          console.warn('[slack/oauth] welcome DM fire-and-forget failed', err);
        }
      });
    }

    // Fire the tenant-admin email past the redirect so the user sees
    // the success page immediately. Resend latency / outage never
    // blocks the install flow.
    after(async () => {
      try {
        await sendSlackInstallReceivedEmail({
          tenantId,
          teamName: install.teamName,
          enterpriseName: install.enterpriseName,
          installedAt: new Date(),
        });
      } catch (err) {
        console.warn('[slack/oauth] install email fire-and-forget failed', err);
      }
    });

    if (kind === 'customer_account' && customerAccount) {
      // Flow B — corporate admin installing into their own workspace.
      // Land them on the B2B2B success page with TMC + account attribution.
      const url = new URL('/install/slack/customer-account/success', req.url);
      url.searchParams.set('tenant', tenantExists.slug);
      url.searchParams.set('account', customerAccount.displayName);
      url.searchParams.set('team', install.teamName);
      return NextResponse.redirect(url);
    }
    if (flow === 'public') {
      // Persona C — end-customer admin who came in via the public
      // /install/slack?tenant=<slug> flow. Land them on the public
      // success page with tenant attribution + workspace label.
      const url = new URL('/install/slack/success', req.url);
      url.searchParams.set('tenant', tenantExists.slug);
      url.searchParams.set('team', install.teamName);
      return NextResponse.redirect(url);
    }
    // Tenant operator who finished the wizard — back into the dashboard.
    return NextResponse.redirect(new URL('/dashboard/channels/slack/connect?installed=1', req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[slack/oauth] exchange failed:', msg);
    return NextResponse.json({ error: 'oauth_exchange_failed', message: msg }, { status: 500 });
  }
}

/**
 * Post-install welcome DM for the corporate admin who installed Sendero
 * into their workspace under Flow B. Fire-and-forget — failure should
 * never block the install flow.
 */
async function sendWelcomeDm(args: {
  botToken: string;
  installerSlackUserId: string;
  tmcDisplayName: string;
  customerDisplayName: string;
}): Promise<void> {
  const client = createSlackClient(args.botToken);
  const text =
    `Welcome to Sendero — installed for *${args.customerDisplayName}* by your travel agency *${args.tmcDisplayName}*.\n\n` +
    `*Next steps:*\n` +
    `• Invite me to a channel: \`/invite @Sendero\` in (for example) #travel.\n` +
    `• Your team requests trips by mentioning me: \`@Sendero book me NYC → LAX next Tuesday\`.\n` +
    `• Policy + approvals are managed by *${args.tmcDisplayName}* — they see every trip in their dashboard.\n` +
    `• I'll post booking confirmations + settlement events in the channel where the trip was requested.`;
  await postMessage(client, {
    channel: args.installerSlackUserId,
    text,
  });
}
