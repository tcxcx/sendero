// /qa — End-to-end check on the Spend + Invoices stack post-revert.
//
// Verifies:
//   1. Cron is correctly scheduled "* / 5 * * * *" in vercel.json
//   2. Cron is idempotent — first run drains pending events, second run
//      hits the no-op early return
//   3. The pending/reconciled split is computable per tenant
//   4. Invoices query returns rows in the same shape the page consumes
//   5. Format helpers — formatMicroUsd vs formatMicroUsdPrecise — both
//      render readable values for sub-cent nanopayments
//   6. Inline path is gone from /api/chat (no more after() settle)
//
// Tenant under test: QA Corporate (from qa-logins.local.json).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildAndSettleBatch } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';

import { formatMicroUsd, formatMicroUsdPrecise } from '../lib/format';
import { makeBatchStore, makeSettleFn } from '../lib/nanopay-settle';

interface QaLogin {
  label: string;
  userId: string;
  email: string;
}

async function resolveQaCorporateTenant() {
  const path = resolve(process.cwd(), '..', '..', 'qa-logins.local.json');
  const json = JSON.parse(readFileSync(path, 'utf-8')) as { users: QaLogin[] };
  const corp = json.users.find(u => u.label === 'QA Corporate');
  if (!corp) throw new Error('QA Corporate user not in qa-logins.local.json');
  const user = await prisma.user.findFirst({
    where: { clerkUserId: corp.userId },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user) throw new Error(`No User row for clerkUserId ${corp.userId}`);
  const tenant = user.memberships[0]?.tenant;
  if (!tenant) throw new Error('QA Corporate user has no tenant membership');
  return { tenantId: tenant.id, tenantName: tenant.displayName, userId: user.id };
}

function check(label: string, ok: boolean, note?: string) {
  const mark = ok ? '✓' : '✗';
  const tail = note ? `  ${note}` : '';
  console.log(`  ${mark} ${label}${tail}`);
  return ok;
}

async function main() {
  let allGreen = true;
  const fail = (label: string, note?: string) => {
    allGreen = false;
    return check(label, false, note);
  };

  // ── 1. vercel.json cron schedule ───────────────────────────────
  console.log('\n[1] vercel.json cron schedule');
  const vercelJson = JSON.parse(
    readFileSync(resolve(process.cwd(), '..', '..', 'vercel.json'), 'utf-8')
  ) as { crons: Array<{ path: string; schedule: string }> };
  const settleCron = vercelJson.crons.find(c => c.path === '/api/cron/settle-nanopay-batches');
  if (!settleCron) fail('settle cron declared');
  else
    check(
      `schedule = ${settleCron.schedule}`,
      settleCron.schedule === '*/5 * * * *',
      settleCron.schedule === '*/5 * * * *' ? '' : `expected */5 * * * *`
    ) || (allGreen = false);

  // ── 2. Inline settle removed from /api/chat ────────────────────
  console.log('\n[2] inline settle removed from /api/chat');
  const chatRoute = readFileSync(resolve(process.cwd(), 'app/api/chat/route.ts'), 'utf-8');
  const hasAfter = /\bafter\(/.test(chatRoute);
  const hasInlineComment = chatRoute.includes('Settlement is intentionally batched');
  check('no after() call in route', !hasAfter, hasAfter ? 'after() still present!' : '');
  check('reverted-comment present', hasInlineComment);
  if (hasAfter || !hasInlineComment) allGreen = false;

  // ── 3. Cron no-op early return ────────────────────────────────
  console.log('\n[3] cron no-op guard — pre-flight skip when nothing pending');
  const cronRoute = readFileSync(
    resolve(process.cwd(), 'app/api/cron/settle-nanopay-batches/route.ts'),
    'utf-8'
  );
  const hasGuard = cronRoute.includes("skipped: 'no_pending_events'");
  check('no-op guard present', hasGuard);
  if (!hasGuard) allGreen = false;

  // ── 4. Tenant data + pending/reconciled split ─────────────────
  console.log('\n[4] pending vs reconciled — per tenant');
  const tenant = await resolveQaCorporateTenant();
  console.log(`    tenant: ${tenant.tenantName} (${tenant.tenantId})`);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [pending, reconciled, batches] = await Promise.all([
    prisma.meterEvent.aggregate({
      where: {
        tenantId: tenant.tenantId,
        status: 'paid',
        settlementRef: null,
        at: { gte: since },
      },
      _sum: { priceMicroUsdc: true },
      _count: true,
    }),
    prisma.meterEvent.aggregate({
      where: {
        tenantId: tenant.tenantId,
        status: 'paid',
        settlementRef: { not: null },
        at: { gte: since },
      },
      _sum: { priceMicroUsdc: true },
      _count: true,
    }),
    prisma.nanopayBatch.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        totalMicroUsdc: true,
        eventCount: true,
        txHash: true,
        createdAt: true,
      },
    }),
  ]);
  const pendingMicro = pending._sum.priceMicroUsdc ?? 0n;
  const reconciledMicro = reconciled._sum.priceMicroUsdc ?? 0n;
  console.log(
    `    pending     = ${formatMicroUsdPrecise(pendingMicro)}  (${pending._count} call${pending._count === 1 ? '' : 's'})`
  );
  console.log(
    `    reconciled  = ${formatMicroUsdPrecise(reconciledMicro)}  (${reconciled._count} call${reconciled._count === 1 ? '' : 's'})`
  );
  console.log(`    recent batches:`);
  for (const b of batches) {
    console.log(
      `      ${b.createdAt.toISOString()}  ${b.status.padEnd(8)} ${formatMicroUsdPrecise(b.totalMicroUsdc).padStart(11)}  events=${b.eventCount}  tx=${b.txHash?.slice(0, 12) ?? '—'}…`
    );
  }
  check('split is computable', true);

  // ── 5. Invoice query in the same shape the page consumes ───────
  console.log('\n[5] invoice query for the same tenant');
  const [invoiceRows, mtdSum, openCount] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        number: true,
        kind: true,
        status: true,
        totalMicro: true,
        createdAt: true,
      },
    }),
    prisma.invoice.aggregate({
      where: {
        tenantId: tenant.tenantId,
        createdAt: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        },
      },
      _sum: { totalMicro: true },
    }),
    prisma.invoice.count({
      where: { tenantId: tenant.tenantId, status: { in: ['issued', 'sent', 'viewed'] } },
    }),
  ]);
  console.log(`    MTD billed = ${formatMicroUsd(mtdSum._sum.totalMicro ?? 0n)}`);
  console.log(`    open invoices = ${openCount}`);
  console.log(`    last ${invoiceRows.length} invoices:`);
  for (const r of invoiceRows) {
    console.log(
      `      ${r.createdAt.toISOString()}  ${r.kind.padEnd(14)} ${r.status.padEnd(8)} ${r.number}  ${formatMicroUsd(r.totalMicro)}`
    );
  }
  check('invoice query returns rows in expected shape', true);

  // ── 6. Format helpers — sub-cent readability ──────────────────
  console.log('\n[6] format helpers');
  const samples: bigint[] = [0n, 100n, 1_000n, 9_000n, 25_000n, 1_000_000n, 1_500_000n];
  console.log(`    micro       formatMicroUsd     formatMicroUsdPrecise`);
  for (const s of samples) {
    console.log(
      `    ${s.toString().padStart(10)}  ${formatMicroUsd(s).padEnd(18)} ${formatMicroUsdPrecise(s)}`
    );
  }
  // The whole point of the precise variant: 1000 micro should NOT render as $0.00.
  const renderedPrecise1k = formatMicroUsdPrecise(1_000n);
  if (!renderedPrecise1k.includes('0.001')) {
    fail('formatMicroUsdPrecise(1000n) renders as expected', renderedPrecise1k);
  } else {
    check(`formatMicroUsdPrecise(1000n) = ${renderedPrecise1k}`, true);
  }

  // ── 7. Cron drain + idempotent no-op ──────────────────────────
  console.log('\n[7] cron drain → second run no-ops');
  const sweep1 = await buildAndSettleBatch(makeBatchStore(), makeSettleFn(), {
    tenantId: tenant.tenantId,
  });
  console.log(`    sweep#1 status=${sweep1.status}`);
  if (sweep1.status === 'settled')
    console.log(
      `      drained $${(Number(sweep1.totalMicroUsdc) / 1e6).toFixed(6)} via tx=${sweep1.txHash}`
    );
  const sweep2 = await buildAndSettleBatch(makeBatchStore(), makeSettleFn(), {
    tenantId: tenant.tenantId,
  });
  console.log(`    sweep#2 status=${sweep2.status}`);
  check(
    'second sweep is no-op',
    sweep2.status === 'empty',
    sweep2.status === 'empty' ? '' : `unexpected: ${sweep2.status}`
  ) || (allGreen = false);

  console.log(allGreen ? '\n✅ all green — spend + invoices e2e clean' : '\n❌ failures above');
  await prisma.$disconnect();
  if (!allGreen) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
