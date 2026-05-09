/**
 * /dashboard/passport/[id]/wallet — operator view of a traveler's
 * DCW + the "Pre-fund this traveler" form.
 *
 *   Crumb · h1 · address card · live unified balance · pre-fund form ·
 *   deposit + spend history.
 *
 * org:admin only — pre-funding moves real corporate funds.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { CopyAddress } from '@/components/wallet/copy-address';
import { PrefundForm } from '@/components/wallet/prefund-form';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { getCircleUnifiedBalanceDelegate } from '@/lib/transfer-policy/app-kit';

const ARC_TESTNET_CHAIN_ID = 5042002;

export const dynamic = 'force-dynamic';

interface DepositRow {
  id: string;
  status: string;
  amountMicroUsdc: bigint;
  txHash: string | null;
  blockReason: string | null;
  createdAt: Date;
}

export default async function TravelerWalletPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const { id } = await params;

  const traveler = await prisma.user.findFirst({
    where: { id, memberships: { some: { tenantId: tenant.id } } },
    select: { id: true, displayName: true, email: true },
  });
  if (!traveler) notFound();

  const wallet = await prisma.wallet.findFirst({
    where: { userId: id, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
    select: { id: true, address: true, chainId: true, circleWalletId: true, createdAt: true },
  });

  const [deposits, spends, balance, pendingBookings, gatewayConfig] = await Promise.all([
    prisma.transferAttempt.findMany({
      where: { tenantId: tenant.id, travelerId: id, kind: 'deposit' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        amountMicroUsdc: true,
        txHash: true,
        blockReason: true,
        createdAt: true,
      },
    }),
    prisma.transferAttempt.findMany({
      where: { tenantId: tenant.id, travelerId: id, kind: 'spend' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        amountMicroUsdc: true,
        recipient: true,
        txHash: true,
        createdAt: true,
      },
    }),
    wallet ? fetchUnifiedBalance(wallet.address, wallet.chainId) : Promise.resolve(null),
    prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        status: 'pending',
        trip: {
          travelerId: id,
          status: { notIn: ['canceled', 'failed', 'completed'] },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        kind: true,
        totalUsd: true,
        currency: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.tenantGatewayConfig.findUnique({
      where: { tenantId: tenant.id },
      select: { evmDepositorAddress: true, solanaDepositorAddress: true, enabledDomains: true },
    }),
  ]);

  const label = traveler.displayName ?? traveler.email ?? traveler.id.slice(0, 12);

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div>
        <h1 className="t-h1">{label}</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Tenant-pre-funded unified balance + transfer history. Funds posted here flow into the
          traveler's spend authority on every Arc booking.
        </p>
      </div>

      {!wallet ? (
        <NoWalletState />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">DCW · Arc Testnet</div>
            <div className="t-mono ink-70" style={{ fontSize: 12, marginTop: 4 }}>
              {wallet.address}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <CopyAddress value={wallet.address} label="copy address" />
              {wallet.circleWalletId ? (
                <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                  · circle id {wallet.circleWalletId.slice(0, 8)}…
                </span>
              ) : null}
            </div>
            <hr
              aria-hidden
              style={{
                border: 0,
                height: 1,
                background: 'var(--hairline-color-soft)',
                margin: '12px 0',
              }}
            />
            <div className="t-meta">Unified USDC balance</div>
            <div className="t-num-lg" style={{ fontSize: 32, marginTop: 4, lineHeight: 1 }}>
              {balance === null ? '—' : `$${balance}`}
            </div>
            <div className="t-mono ink-60" style={{ fontSize: 10.5, marginTop: 6 }}>
              {balance === null
                ? 'live balance unavailable (Gateway API or tenant Gateway not configured)'
                : 'live · gateway.getBalances'}
            </div>
          </div>

          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <PrefundForm
              travelerId={id}
              travelerAddress={wallet.address}
              defaultAmount="50"
              pendingBookings={pendingBookings.map(b => ({
                id: b.id,
                kind: b.kind,
                supplierName: b.supplier?.name ?? null,
                amount: b.totalUsd.toFixed(2),
                currency: b.currency,
              }))}
            />
            <hr
              aria-hidden
              style={{
                border: 0,
                height: 1,
                background: 'var(--hairline-color-soft)',
                margin: '12px 0',
              }}
            />
            <div className="t-meta">Org Gateway source</div>
            <div className="t-mono ink-70" style={{ fontSize: 11, marginTop: 4 }}>
              {gatewayConfig ? (
                <>
                  {gatewayConfig.evmDepositorAddress.slice(0, 12)}…
                  {gatewayConfig.evmDepositorAddress.slice(-6)}{' '}
                  <CopyAddress value={gatewayConfig.evmDepositorAddress} label="copy" />
                </>
              ) : (
                'Tenant Gateway is not provisioned yet.'
              )}
            </div>
            <div className="t-body ink-60" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
              Prepaid trips, booking pay links, and manual traveler pre-funds debit this org's
              Gateway context. Provisioned claim links are sent back through the traveler's
              connected channel.
            </div>
          </div>
        </div>
      )}

      <DepositHistory rows={deposits} />
      <SpendHistory rows={spends} />
    </div>
  );
}

function NoWalletState() {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: '36px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: 'var(--tint-vermillion-soft)',
          color: 'var(--vermillion)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 20,
        }}
      >
        ⛁
      </div>
      <div className="t-h3">No DCW wallet yet</div>
      <div className="t-body ink-70" style={{ fontSize: 13, maxWidth: '52ch', lineHeight: 1.55 }}>
        Wallets provision lazily at hold — once this traveler triggers a booking, their wallet will
        appear here and pre-funding becomes available.
      </div>
    </div>
  );
}

function DepositHistory({ rows }: { rows: DepositRow[] }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="t-meta">Deposits</div>
      {rows.length === 0 ? (
        <div className="t-body ink-60" style={{ fontSize: 13 }}>
          No tenant deposits yet.
        </div>
      ) : (
        <div
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 0 }}
        >
          {rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 100px 100px 1fr 120px',
                padding: '10px 16px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                alignItems: 'center',
              }}
            >
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
              <span className="t-num-md" style={{ fontSize: 13 }}>
                ${formatMicro(r.amountMicroUsdc)}
              </span>
              <span
                className={`sd-pill sd-pill-${r.status === 'executed' ? 'sea' : r.status === 'failed' ? 'verm' : 'outline'}`}
                style={{ fontSize: 9, padding: '2px 7px', justifySelf: 'start' }}
              >
                {r.status.toUpperCase()}
              </span>
              <span className="t-mono ink-70" style={{ fontSize: 11 }}>
                {r.txHash ? `tx ${r.txHash.slice(0, 14)}…` : (r.blockReason ?? '—')}
              </span>
              <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                {r.id.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SpendHistory({
  rows,
}: {
  rows: Array<{
    id: string;
    status: string;
    amountMicroUsdc: bigint;
    recipient: string;
    txHash: string | null;
    createdAt: Date;
  }>;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="t-meta">Spends</div>
      {rows.length === 0 ? (
        <div className="t-body ink-60" style={{ fontSize: 13 }}>
          No spends yet.
        </div>
      ) : (
        <div
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: 0 }}
        >
          {rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 100px 100px 1fr',
                padding: '10px 16px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                alignItems: 'center',
              }}
            >
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
              <span className="t-num-md" style={{ fontSize: 13 }}>
                ${formatMicro(r.amountMicroUsdc)}
              </span>
              <span
                className={`sd-pill sd-pill-${r.status === 'executed' ? 'sea' : r.status === 'failed' || r.status === 'blocked' ? 'verm' : 'outline'}`}
                style={{ fontSize: 9, padding: '2px 7px', justifySelf: 'start' }}
              >
                {r.status.toUpperCase()}
              </span>
              <span className="t-mono ink-70" style={{ fontSize: 11 }}>
                → {r.recipient.slice(0, 10)}…{r.recipient.slice(-6)}
                {r.txHash ? ` · tx ${r.txHash.slice(0, 10)}…` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function unifiedBalanceChainForWallet(chainId: number): 'Arc_Testnet' | 'Solana_Devnet' {
  return chainId === 5 ? 'Solana_Devnet' : 'Arc_Testnet';
}

async function fetchUnifiedBalance(address: string, chainId: number): Promise<string | null> {
  const delegate = getCircleUnifiedBalanceDelegate();
  if (!delegate) return null;
  try {
    const result = await delegate.kit.getBalances({
      sources: [
        { adapter: delegate.adapter, address, chains: unifiedBalanceChainForWallet(chainId) },
      ],
      networkType: 'testnet',
      includePending: true,
    });
    return result.totalConfirmedBalance;
  } catch (err) {
    console.warn('[wallet] kit.getBalances failed', err instanceof Error ? err.message : err);
    return null;
  }
}

function formatMicro(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  if (!fracStr) return whole.toString();
  // Trim to 2 decimals for display
  return `${whole}.${fracStr.slice(0, 2).padEnd(2, '0')}`;
}
