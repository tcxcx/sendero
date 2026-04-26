/**
 * GET /api/cron/retry-identity-provision
 *
 * Sweeper that fills gaps left when the synchronous identity-mint hook
 * (post-`provisionTenantWallet` / post-`ensureTravelerWallet`) couldn't
 * register an ERC-8004 agent NFT — Circle 5xx, Arc-Testnet RPC blip,
 * mid-deploy crash, etc.
 *
 * Picks `OnchainIdentity` rows where `status='pending' AND updatedAt <
 * now()-60s`, retries via `ensureOrgIdentity` / `ensureUserIdentity`,
 * and after `MAX_ATTEMPTS` consecutive failures flips the row to
 * `status='failed'` for admin review.
 *
 * Scheduled every 5 minutes via apps/app/vercel.json. Bounded to 50
 * candidates per run inside `sweepPendingIdentities` itself.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { sweepPendingIdentities } from '@sendero/tools/provision-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const report = await sweepPendingIdentities();
  return NextResponse.json({ ok: true, ...report });
}
