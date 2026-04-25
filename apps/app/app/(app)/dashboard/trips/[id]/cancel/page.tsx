/**
 * /dashboard/trips/[tripId]/cancel — buyer cancel-sweep landing page.
 *
 * Reached via the deep-link in `claim_lockout` SecurityAlert
 * notifications (`?reason=lockout`). Mirrors the OTP design doc's
 * "Recommended buyer UX" sketch: explain what happened, give two
 * one-click escape hatches (rotate code OR cancel + sweep), and show
 * the funds-at-risk + lockout window.
 *
 * Auth model:
 *   - Clerk session required (parent (app) layout enforces this).
 *   - Tenant must own the Trip row (otherwise 403 → notFound to avoid
 *     leaking trip ids via differential responses).
 *   - The active tenant's CircleWallet address must match the
 *     on-chain `Trip.buyer` (otherwise 403 — only the buyer can
 *     cancel + sweep). This check uses on-chain truth; the metadata
 *     on the Trip row is convenience only.
 *
 * Side-effect on land:
 *   - If the deep-link reason is `lockout` AND there's an
 *     unacknowledged `SecurityAlert` matching this trip, mark it
 *     acknowledged with the active user. Idempotent.
 */

import { notFound } from 'next/navigation';

import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { Crumb } from '@/components/console/crumb';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { CancelActionsCard } from './cancel-actions-card';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface TripView {
  /** Off-chain Trip.id (cuid). For trips minted via prefund_trip this is also the on-chain bytes32 hex. */
  id: string;
  /** On-chain bytes32 hex used by the contract. */
  onchainTripId: `0x${string}`;
  status: string;
  budgetMicroUsdc: bigint | null;
  destination: string;
  shortId: string;
  /** Unix seconds when the lockout expires; null when not under lockout. */
  lockedUntilUnix: number | null;
  /** When true, the active tenant's CircleWallet matches the on-chain buyer. */
  isBuyer: boolean;
}

function searchReason(v: string | string[] | undefined): 'lockout' | 'manual' | 'unknown' {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === 'lockout') return 'lockout';
  if (s === 'manual') return 'manual';
  return 'unknown';
}

function asHex32(s: string): `0x${string}` | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return null;
  return s.toLowerCase() as `0x${string}`;
}

/** Read the most recent unacknowledged `claim_lockout` alert for this trip. */
async function loadLatestLockoutAlert(onchainTripId: string) {
  return prisma.securityAlert.findFirst({
    where: {
      onchainTripId: onchainTripId.toLowerCase(),
      kind: 'claim_lockout',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      acknowledgedAt: true,
      payload: true,
      createdAt: true,
    },
  });
}

export default async function CancelTripPage({ params, searchParams }: PageProps) {
  const { id: tripIdParam } = await params;
  const sp = await searchParams;
  const reason = searchReason(sp.reason);

  const { tenant, userId } = await requireCurrentTenant();
  const trip = await prisma.trip.findFirst({
    where: { id: tripIdParam, tenantId: tenant.id },
    select: {
      id: true,
      status: true,
      totalUsdc: true,
      intent: true,
      metadata: true,
    },
  });
  if (!trip) notFound();

  // For prefund_trip-minted trips the off-chain id equals the on-chain bytes32 hex.
  // If the row id isn't a hex32 (legacy trips), fall back to a metadata pointer.
  const onchainTripId =
    asHex32(trip.id) ??
    (() => {
      const meta = (trip.metadata ?? {}) as { escrow?: { tripId?: string } };
      return meta.escrow?.tripId ? asHex32(meta.escrow.tripId) : null;
    })();
  if (!onchainTripId) notFound();

  // Tenant's CircleWallet (the candidate buyer). If the tenant has
  // multiple wallets we accept a match against ANY of them — the
  // contract enforces single-buyer at the bytes level.
  const wallets = await prisma.circleWallet.findMany({
    where: { tenantId: tenant.id },
    select: { address: true },
  });
  const tenantAddrs = new Set(wallets.map(w => w.address.toLowerCase()));

  // Buyer address from the indexer's `trip` table (preferred — fresh,
  // fast). Falls back to the tenant-scoped Trip metadata if the
  // indexer hasn't seen the trip yet.
  const buyerOnchain = await readBuyerFromIndexer(onchainTripId);
  const buyerAddr =
    buyerOnchain ?? (trip.metadata as { buyer?: string } | null)?.buyer?.toLowerCase() ?? null;
  const isBuyer = buyerAddr ? tenantAddrs.has(buyerAddr) : false;
  if (!isBuyer) {
    // Avoid a leak: render the same notFound() the wrong-tenant branch
    // hits. The buyer is the only legitimate viewer.
    notFound();
  }

  // Mark lockout alert acknowledged on land (only for the lockout deep
  // link). Don't crash on race — multiple tabs can land at once.
  const lockoutAlert = await loadLatestLockoutAlert(onchainTripId);
  if (reason === 'lockout' && lockoutAlert && !lockoutAlert.acknowledgedAt) {
    const user = await currentUser();
    await prisma.securityAlert
      .update({
        where: { id: lockoutAlert.id },
        data: {
          acknowledgedAt: new Date(),
          acknowledgedBy: user?.primaryEmailAddress?.emailAddress ?? userId,
        },
      })
      .catch(() => {
        // Race with another tab is fine; the column is monotonic.
      });
  }

  const lockedUntilUnix = (() => {
    const payload = lockoutAlert?.payload as { lockedUntil?: string } | null;
    if (!payload?.lockedUntil) return null;
    const n = Number(payload.lockedUntil);
    return Number.isFinite(n) ? n : null;
  })();
  const lockedUntilDate = lockedUntilUnix ? new Date(lockedUntilUnix * 1000) : null;
  const lockedActive = lockedUntilDate ? lockedUntilDate.getTime() > Date.now() : false;

  const intent = (trip.intent ?? {}) as Record<string, unknown>;
  const destination = (typeof intent.destination === 'string' && intent.destination) || 'Trip';
  const shortId = trip.id.slice(0, 8).toUpperCase();
  const fundsAtRiskUsdc = trip.totalUsdc?.toString() ?? null;

  // Disabled-reason copy. The action card honors this and renders both
  // buttons disabled with the helper text below.
  const disabledReason = (() => {
    if (trip.status === 'canceled') {
      return 'Trip already cancelled — funds were swept previously.';
    }
    if (trip.status === 'completed') {
      return 'Trip already settled — vendor has been paid; nothing to reclaim.';
    }
    if (reason === 'lockout' && !lockoutAlert && !lockedActive) {
      return 'No active lockout on this trip. You can still cancel + reclaim, but the protection has expired.';
    }
    return null;
  })();

  const view: TripView = {
    id: trip.id,
    onchainTripId,
    status: trip.status,
    budgetMicroUsdc: null,
    destination,
    shortId,
    lockedUntilUnix,
    isBuyer,
  };

  return (
    <div
      style={{
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Crumb trail={['Trips', view.shortId, 'Cancel']} />

      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h1 className="t-h1">Suspicious activity on Trip {view.shortId}</h1>
          {reason === 'lockout' ? (
            <p
              className="t-body-lg ink-70"
              style={{ marginTop: 6, maxWidth: '60ch' }}
              data-testid="lockout-explainer"
            >
              Three failed attempts to claim this trip&apos;s code happened in the last few minutes.
              The on-chain protection has locked the trip
              {lockedUntilDate ? (
                <>
                  {' '}
                  until{' '}
                  <span className="t-mono" suppressHydrationWarning>
                    {lockedUntilDate.toISOString()}
                  </span>
                  .
                </>
              ) : (
                ' for 15 minutes.'
              )}
            </p>
          ) : (
            <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
              Cancel this trip and reclaim any unspent USDC back to your treasury.
            </p>
          )}
        </div>

        {reason === 'lockout' ? (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: '#fdfbf7',
              border: '1px solid var(--ink-15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                Most likely one of:
              </span>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <li className="t-body">
                  Your guest mistyped the code → <strong>send a fresh code</strong>.
                </li>
                <li className="t-body">
                  Someone with the link tried to brute-force the OTP →{' '}
                  <strong>cancel + reclaim funds</strong>.
                </li>
              </ul>
            </div>

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 16,
                rowGap: 6,
                margin: 0,
                fontSize: 12,
              }}
            >
              {lockedUntilDate ? (
                <>
                  <dt className="t-mono ink-60">Locked until</dt>
                  <dd className="t-mono" style={{ margin: 0 }} suppressHydrationWarning>
                    {lockedUntilDate.toISOString()}
                  </dd>
                </>
              ) : null}
              {fundsAtRiskUsdc ? (
                <>
                  <dt className="t-mono ink-60">Funds at risk</dt>
                  <dd className="t-mono" style={{ margin: 0 }}>
                    ${fundsAtRiskUsdc} USDC
                  </dd>
                </>
              ) : null}
              <dt className="t-mono ink-60">Trip id</dt>
              <dd className="t-mono" style={{ margin: 0, wordBreak: 'break-all' }}>
                {view.onchainTripId}
              </dd>
              <dt className="t-mono ink-60">Status</dt>
              <dd className="t-mono" style={{ margin: 0 }}>
                {view.status}
              </dd>
            </dl>
          </div>
        ) : null}

        <CancelActionsCard
          tripId={view.id}
          onchainTripId={view.onchainTripId}
          disabledReason={disabledReason}
        />
      </div>
    </div>
  );
}

/**
 * Read the buyer address from the Ponder indexer's `trip` table.
 * Falls back to null when the indexer hasn't observed the trip yet
 * (the page-level fallback then tries `Trip.metadata.buyer`).
 *
 * We use raw SQL because the Ponder schema is in a separate Drizzle
 * namespace; including it in Prisma would require generating a second
 * client and the column-set is small.
 */
async function readBuyerFromIndexer(onchainTripId: `0x${string}`): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ buyer: string | null }[]>(
      'SELECT buyer FROM trip WHERE id = $1::bytea LIMIT 1',
      onchainTripId
    );
    const buyer = rows[0]?.buyer;
    return buyer ? buyer.toLowerCase() : null;
  } catch {
    // Indexer schema may live in a separate database in some envs;
    // returning null defers to the metadata fallback.
    return null;
  }
}
