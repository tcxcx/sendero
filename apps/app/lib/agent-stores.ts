/**
 * Shared store factories + resolvers for `runAgentTurn` callers.
 *
 * Both `apps/app/app/api/agent/dispatch/route.ts` (the canonical agent
 * dispatch) and `apps/app/lib/slack-agent.ts` (the Slack channel adapter)
 * need the same Prisma-backed `CapStore`, `MeterStore`, `SessionStore`,
 * and `resolveSegment` implementations. Keeping them in one place
 * prevents drift — change Prisma column once, both callers pick it up.
 *
 * Dispatch route still owns model selection + persona + the API-key /
 * signature path; that's request-shape concern. These helpers are pure
 * data plumbing.
 */

import type { CapStore } from '@sendero/billing/caps';
import type { MeterEventInput, MeterStore } from '@sendero/billing/meter';
import type { BillingSegment } from '@sendero/billing/pricing';
import type { ConversationState, SessionStore } from '@sendero/agent';
import { prisma } from '@sendero/database';

export function makeCapStore(): CapStore {
  return {
    listForTenant: async tenantId => {
      const caps = await prisma.tenantSpendCap.findMany({
        where: { tenantId },
        select: {
          tenantId: true,
          period: true,
          amountMicroUsdc: true,
          hardCap: true,
          alertWebhookUrl: true,
        },
      });
      return caps;
    },
    spentInWindow: async ({ tenantId, windowStartedAt }) => {
      const agg = await prisma.meterEvent.aggregate({
        where: { tenantId, status: 'paid', at: { gte: windowStartedAt } },
        _sum: { priceMicroUsdc: true },
      });
      return agg._sum.priceMicroUsdc ?? 0n;
    },
  };
}

export function makeMeterStore(opts?: { forceStatus?: 'sandbox' }): MeterStore {
  return {
    create: async (input: MeterEventInput) => {
      const idempotencyKey =
        input.metadata &&
        typeof input.metadata === 'object' &&
        'idempotencyKey' in input.metadata &&
        typeof (input.metadata as Record<string, unknown>).idempotencyKey === 'string'
          ? ((input.metadata as Record<string, unknown>).idempotencyKey as string)
          : null;
      // Sandbox keys (or production-downgraded-in-testnet) still record
      // meter events for analytics, but NanopayBatch ignores them so no
      // real USDC moves. Overriding status here is the single chokepoint.
      const status = opts?.forceStatus ?? input.status;
      const row = await prisma.meterEvent.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          payerAddress: input.payerAddress ?? null,
          toolName: input.toolName,
          priceMicroUsdc: input.priceMicroUsdc,
          status,
          settlementRef: input.settlementRef ?? null,
          note: input.note ?? null,
          metadata: (input.metadata as object | undefined) ?? undefined,
          idempotencyKey,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}

export function makeSessionStore(): SessionStore {
  return {
    getByActor: async ({ tenantId, subjectKey }) => {
      const row = await prisma.session.findUnique({
        where: { tenantId_subjectKey: { tenantId, subjectKey } },
        select: { id: true, threadContext: true },
      });
      if (!row) return null;
      const ctx = row.threadContext as { conversation?: ConversationState } | null | undefined;
      const state = ctx?.conversation ?? { turns: [], subjectKey };
      return { id: row.id, state };
    },
    upsert: async ({ tenantId, userId, subjectKey, state, expiresAt }) => {
      const row = await prisma.session.upsert({
        where: { tenantId_subjectKey: { tenantId, subjectKey } },
        create: {
          tenantId,
          userId: userId ?? null,
          subjectKey,
          threadContext: { conversation: state } as object,
          expiresAt: expiresAt ?? null,
        },
        update: {
          threadContext: { conversation: state } as object,
          expiresAt: expiresAt ?? null,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}

export async function resolveSegment(tenantId: string): Promise<BillingSegment> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingTier: true },
  });
  if (!tenant) return 'consumer';
  switch (tenant.billingTier) {
    case 'enterprise':
      return 'corporate';
    case 'business':
      return 'corporate';
    case 'pro':
      return 'agency';
    default:
      return 'consumer';
  }
}
