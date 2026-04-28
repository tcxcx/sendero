/**
 * GET /api/cron/reconcile-credits
 *
 * Hourly safety net for `Subscription.meterBalanceMicro` cycle resets
 * that Clerk webhooks missed.
 *
 * The primary refill path is the Clerk Billing
 * `subscription.{created,updated,active}` webhook handler at
 * `/api/webhooks/clerk/route.ts::onSubscriptionUpsert`. Svix retries
 * on transient failures. This sweeper is the second line of defense:
 * any Subscription whose `currentPeriodEnd` has passed but whose
 * `meterBalanceMicro` is below the current grant gets refilled from
 * `PLANS[tier].monthlyIncludedCreditsMicro` here.
 *
 * Hourly cadence per the autoplan eng review's Risk-4 mitigation:
 * worst-case staleness drops from 24h to 1h. The cap query is bounded
 * (LIMIT 100) so a backlog can't blow the function timeout — we'll
 * catch up on the next hourly tick.
 *
 * Idempotent: a Subscription that was already refilled for the new
 * period passes the guard (`meterBalanceMicro >= grant`) and is
 * skipped silently. Concurrent execution is safe — the UPDATE is
 * scoped per-row.
 *
 * **Status gate.** Only refills tenants whose `status` is `active` or
 * `trialing`. `past_due` and `canceled` tenants keep their existing
 * balance (they paid for it) but never get a top-up — that's the
 * revenue-leak fix per the autoplan eng review's failure mode #8.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 *
 * Scheduled hourly via apps/app/vercel.json (`0 * * * *`).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { PLANS, type PlanTier } from '@sendero/billing/plans';
import type { BillingTier } from '@sendero/database';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RECONCILIATION_BATCH_SIZE = 100;

function billingTierToPlanTier(tier: BillingTier): PlanTier {
  // BillingTier carries `business` for backward-compat; map it to the
  // closest PlanTier so the credit envelope still resolves cleanly.
  if (tier === 'business') return 'pro';
  if (tier === 'basic' || tier === 'pro' || tier === 'enterprise' || tier === 'free') {
    return tier;
  }
  return 'free';
}

interface ReconciliationReport {
  ok: true;
  scanned: number;
  refilled: number;
  skipped: number;
  errors: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // Pull subscriptions whose current cycle has rolled over (period_end
  // is in the past) and whose status is still spending-eligible. The
  // ORDER BY oldest-period-end-first makes sure tenants who renewed
  // longest ago get caught up before recent renewals — fairness under
  // backlog.
  const candidates = await prisma.subscription.findMany({
    where: {
      OR: [{ status: 'active' }, { status: 'trialing' }],
      currentPeriodEnd: { lte: now },
    },
    select: {
      id: true,
      tenantId: true,
      tier: true,
      meterBalanceMicro: true,
      currentPeriodEnd: true,
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: RECONCILIATION_BATCH_SIZE,
  });

  let refilled = 0;
  let skipped = 0;
  let errors = 0;

  for (const sub of candidates) {
    const planTier = billingTierToPlanTier(sub.tier);
    const grant = PLANS[planTier].monthlyIncludedCreditsMicro;

    // Tenants with no grant (free tier) never need a refill — skip.
    if (grant === null) {
      skipped++;
      continue;
    }

    // If balance is already at or above the grant, the webhook fired
    // and got the cycle reset before us — no-op.
    if (sub.meterBalanceMicro >= grant) {
      skipped++;
      continue;
    }

    try {
      // Conditional update — same-cycle race protection. If another
      // process (the webhook arriving slightly late) refilled while we
      // were iterating, the WHERE clause makes this a no-op rather
      // than a duplicate top-up.
      const result = await prisma.subscription.updateMany({
        where: {
          id: sub.id,
          meterBalanceMicro: { lt: grant },
          // We don't extend currentPeriodEnd here — only the webhook
          // knows the next period boundary. Refilling balance to the
          // grant is the only thing this cron is allowed to do; the
          // next renewal webhook will set the new period_end.
        },
        data: {
          meterBalanceMicro: grant,
          dailyCreditBurnMicro: 0n,
          dailyWindowStartedAt: null,
        },
      });
      if (result.count > 0) {
        refilled++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error('[cron/reconcile-credits] failed to refill subscription', {
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        err,
      });
      errors++;
    }
  }

  const report: ReconciliationReport = {
    ok: true,
    scanned: candidates.length,
    refilled,
    skipped,
    errors,
  };
  return NextResponse.json(report);
}
