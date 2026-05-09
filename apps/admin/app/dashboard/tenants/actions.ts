'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

const MICRO_USDC = 1_000_000n;

type SlackRouting = {
  defaultChannel?: unknown;
};

function routingChannel(routing: unknown) {
  if (!routing || typeof routing !== 'object') return null;
  const value = (routing as SlackRouting).defaultChannel;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function money(value: bigint | number | null | undefined) {
  const micro = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const dollars = micro / MICRO_USDC;
  const cents = (micro % MICRO_USDC) / 10_000n;
  return `$${dollars.toLocaleString()}.${cents.toString().padStart(2, '0')}`;
}

export async function briefSupportAgentAction(formData: FormData) {
  const access = await requirePlatformRole(['superadmin', 'support']);
  if (!access.ok) return;

  const tenantId = String(formData.get('tenantId') ?? '');
  if (!tenantId) return;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      billingTier: true,
      primaryChain: true,
      arcAddress: true,
      slackInstalls: {
        where: { revokedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: {
          botToken: true,
          routing: true,
          teamName: true,
        },
      },
      circleWallets: {
        where: { kind: 'treasury' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: {
          address: true,
          chain: true,
          usdcBalanceMicro: true,
        },
      },
      channelHandoffs: {
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          question: true,
          channel: true,
        },
      },
      supportTurns: {
        where: { outcome: { in: ['escalated', 'unresolved'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          outcome: true,
          turnSummary: true,
        },
      },
      settlements: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          status: true,
          grossMicroUsdc: true,
          senderoTakeMicroUsdc: true,
        },
      },
    },
  });

  const install = tenant?.slackInstalls[0];
  const channel = routingChannel(install?.routing);
  if (!tenant || !install || !channel) return;

  const treasuryAddress = tenant.arcAddress ?? tenant.circleWallets[0]?.address ?? 'not configured';
  const recentSettlement = tenant.settlements[0];
  const handoffLines = tenant.channelHandoffs.length
    ? tenant.channelHandoffs.map(handoff => `• ${handoff.channel}: ${handoff.question}`).join('\n')
    : '• No pending customer handoffs.';
  const supportLines = tenant.supportTurns.length
    ? tenant.supportTurns.map(turn => `• ${turn.outcome}: ${turn.turnSummary}`).join('\n')
    : '• No unresolved support turns.';

  const text = [
    `*Customer support brief: ${tenant.displayName}*`,
    `Tenant: \`${tenant.slug}\` · ${tenant.billingTier} · primary chain ${tenant.primaryChain}`,
    `Treasury: \`${treasuryAddress}\``,
    recentSettlement
      ? `Latest settlement: ${recentSettlement.status} · gross ${money(recentSettlement.grossMicroUsdc)} · Sendero take ${money(recentSettlement.senderoTakeMicroUsdc)}`
      : 'Latest settlement: none recorded',
    '',
    '*Pending handoffs*',
    handoffLines,
    '',
    '*Escalated support turns*',
    supportLines,
  ].join('\n');

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${install.botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text,
      unfurl_links: false,
      mrkdwn: true,
    }),
  });

  revalidatePath('/dashboard/tenants');
}
