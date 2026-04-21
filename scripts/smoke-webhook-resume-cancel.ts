#!/usr/bin/env bun
/**
 * Full E2E phase-11a failure path smoke.
 *
 * Mirrors smoke-webhook-resume-settle but drives the `otherwise` branch
 * of duffel_gate by posting a webhook with status=failed. On resume, the
 * workflow should run `cancel_booking` which emits two encoded calls
 * (refundBooking + sweepUnspent). The smoke submits them (with an
 * `cancelTrip` injected between so the sweep's expiry guard clears
 * without wall-clock wait) and asserts the escrow contract is net-zero
 * (all budget returned to the buyer).
 *
 * Usage: bun run smoke:resume-cancel
 */

import { createHmac } from 'node:crypto';
import {
  buildClaimTripCalls,
  computeGuestIdHash,
  encodeCommitBooking,
  encodeReserveForBooking,
  generateBookingId,
  generateClaimKeypair,
  generateTripId,
  SENDERO_GUEST_ESCROW_ABI,
  signClaim,
  toUsdcMicro,
  USDC_ABI,
} from '@sendero/guest';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEventLogs,
  zeroHash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { prisma } from '../packages/database/src';
import { bookFlightWorkflow } from '../packages/workflows/src/catalog';
import type { WorkflowRun } from '../packages/workflows/src/types';

// ─── config ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);
const ESCROW = (process.env.ARC_ESCROW_ADDRESS ??
  process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
  '') as Address;
const USDC = (process.env.ARC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as Address;
const PK = (process.env.TREASURY_PRIVATE_KEY ?? '') as Hex;
const WEBHOOK_SECRET = process.env.DUFFEL_WEBHOOK_SECRET ?? '';

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error('[smoke/resume-cancel] TREASURY_PRIVATE_KEY missing or malformed');
  process.exit(1);
}
if (!ESCROW || !/^0x[0-9a-fA-F]{40}$/.test(ESCROW)) {
  console.error('[smoke/resume-cancel] ARC_ESCROW_ADDRESS missing or malformed');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('[smoke/resume-cancel] DUFFEL_WEBHOOK_SECRET missing');
  process.exit(1);
}

const operator = privateKeyToAccount(PK);
const chain = {
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, account: operator, transport: http(RPC) });

// ─── helpers ─────────────────────────────────────────────────────────────

async function usdcBalanceOf(addr: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [addr],
  }) as Promise<bigint>;
}

function signWebhookBody(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

async function ensureServerUp(): Promise<void> {
  try {
    const r = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
    if (!(r.ok || r.status === 404 || r.status === 307)) {
      throw new Error(`bad status ${r.status}`);
    }
  } catch (err) {
    console.error(
      `[smoke/resume-cancel] dev server not reachable at ${BASE_URL} — start it first`
    );
    throw err;
  }
}

function buildPausedRun(args: {
  runId: string;
  tripId: Hex;
  bookingId: Hex;
  vendorAddress: Address;
  vendorAmountUsdc: string;
  feeAmountUsdc: string;
  itineraryHash: Hex;
  itineraryCID: string;
  orderHash: Hex;
  pausedAt: Date;
  startedAt: Date;
}): WorkflowRun {
  return {
    workflowId: bookFlightWorkflow.id,
    runId: args.runId,
    status: 'paused',
    startedAt: args.startedAt,
    pausedAt: args.pausedAt,
    pauseReason: 'external_event',
    pausePayload: { via: 'duffel_order_ticketed' },
    nextStepId: 'await_duffel_ticket',
    scratchpad: {
      input: { tripId: args.tripId },
      reservation: { bookingId: args.bookingId },
      hold: {
        orderHash: args.orderHash,
        vendorAddress: args.vendorAddress,
        vendorAmountUsdc: args.vendorAmountUsdc,
        feeAmountUsdc: args.feeAmountUsdc,
        itineraryHash: args.itineraryHash,
        itineraryCID: args.itineraryCID,
        // trailing settle_split still runs even on the cancel branch —
        // keep it happy so the workflow completes cleanly.
        totalUsd: '0.30',
        supplierAddress: args.vendorAddress,
      },
    },
    trail: [
      {
        stepId: 'commit',
        kind: 'tool',
        label: 'Commit vendor amount + release slack',
        startedAt: args.startedAt,
        finishedAt: args.pausedAt,
        ok: true,
      },
    ],
  };
}

function extractCancelCalls(snapshot: WorkflowRun): Array<{
  to: Address;
  data: Hex;
  value: string;
}> {
  const pad = snapshot.scratchpad as Record<string, any>;
  const calls = pad.cancel?.onchainCalls as Array<{ to: Address; data: Hex; value: string }>;
  if (!Array.isArray(calls) || calls.length !== 2) {
    console.error('[smoke/resume-cancel] resumed scratchpad missing cancel.onchainCalls:', {
      keys: Object.keys(pad),
      cancel: pad.cancel,
    });
    throw new Error('resumed scratchpad missing cancel.onchainCalls');
  }
  return calls;
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  await ensureServerUp();

  const TENANT_ID = `smoke-resume-cancel-${Date.now()}`;
  const duffelOrderId = `ord_smoke_cancel_${Date.now()}`;
  const vendorAddress = operator.address;
  const budget = toUsdcMicro('0.20');
  const upperBound = toUsdcMicro('0.18');
  const vendorAmount = toUsdcMicro('0.12');
  const feeAmount = toUsdcMicro('0.03');
  // Short expiry so the trip can be cancelled via cancelTrip in this run
  // (matches the cancel-path scenario in smoke-guest-escrow.ts).
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 120);
  const tripId = generateTripId();
  const bookingId = generateBookingId();
  const itineraryHash = computeGuestIdHash({ email: 'cancel@sendero.test', nonce: zeroHash });
  const orderHash = ('0x' +
    Buffer.from(`duffel-${duffelOrderId}`).toString('hex').padEnd(64, '0').slice(0, 64)) as Hex;

  console.log(`[smoke/resume-cancel] operator       = ${operator.address}`);
  console.log(`[smoke/resume-cancel] escrow         = ${ESCROW}`);
  console.log(`[smoke/resume-cancel] tripId         = ${tripId}`);
  console.log(`[smoke/resume-cancel] bookingId      = ${bookingId}`);
  console.log(`[smoke/resume-cancel] duffelOrderId  = ${duffelOrderId}`);
  console.log();

  let tenantCreated = false;
  let tripCreated = false;
  let bookingCreated = false;

  try {
    // ─── 1. Prisma seed ────────────────────────────────────────────────
    await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        clerkOrgId: `org_${TENANT_ID}`,
        slug: TENANT_ID,
        displayName: 'Resume-cancel smoke',
        billingTier: 'free',
      },
    });
    tenantCreated = true;

    const trip = await prisma.trip.create({
      data: {
        tenantId: TENANT_ID,
        intent: { origin: 'SFO', destination: 'JFK' },
        status: 'booked',
      },
      select: { id: true },
    });
    tripCreated = true;

    const booking = await prisma.booking.create({
      data: {
        tenantId: TENANT_ID,
        tripId: trip.id,
        kind: 'flight',
        status: 'confirmed',
        duffelOrderId,
        totalUsd: '0.12',
        currency: 'USD',
      },
      select: { id: true },
    });
    bookingCreated = true;
    console.log(`[smoke/resume-cancel] seeded tenant=${TENANT_ID} booking=${booking.id}`);

    // Snapshot escrow balance BEFORE any on-chain activity for this trip.
    // After the full cancel path, the delta should be 0 (budget → in, then
    // refund+sweep → out). USDC is the gas token so the buyer EOA balance
    // is noisy; the escrow contract balance is the clean signal.
    const escrowBefore = await usdcBalanceOf(ESCROW);
    console.log(`[smoke/resume-cancel] escrowBefore = ${escrowBefore} micro-USDC`);

    // ─── 2. On-chain: approve + createTrip + claim + reserve + commit ──
    console.log('[smoke/resume-cancel] 2/5  on-chain setup (approve/create/claim/reserve/commit)');
    const approveTx = await wallet.writeContract({
      address: USDC,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [ESCROW, budget],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    const claimKp = generateClaimKeypair();
    const createTx = await wallet.writeContract({
      address: ESCROW,
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'createTrip',
      args: [
        tripId,
        claimKp.pubKey20,
        budget,
        expiresAt,
        zeroHash,
        'ipfs://smoke-resume-cancel',
        BigInt(process.env.SENDERO_AGENT_TOKEN_ID ?? '2286'),
        zeroHash,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: createTx });

    const signature = await signClaim({
      claimPrivateKey: claimKp.privateKey,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      tripId,
      guestWallet: operator.address,
    });
    const [claimCall] = buildClaimTripCalls({
      escrow: ESCROW,
      tripId,
      guestWallet: operator.address,
      signature,
      claimCodePreimage: '0x',
    });
    const claimTx = await wallet.sendTransaction({
      to: claimCall.to,
      data: claimCall.data,
      value: claimCall.value,
    });
    await publicClient.waitForTransactionReceipt({ hash: claimTx });

    const reserveCall = encodeReserveForBooking({
      escrow: ESCROW,
      tripId,
      bookingId,
      upperBound,
    });
    const reserveTx = await wallet.sendTransaction({
      to: reserveCall.to,
      data: reserveCall.data,
      value: reserveCall.value,
    });
    await publicClient.waitForTransactionReceipt({ hash: reserveTx });

    const commitCall = encodeCommitBooking({
      escrow: ESCROW,
      bookingId,
      vendorAmount,
      feeAmount,
      vendor: vendorAddress,
      itineraryHash,
      itineraryCID: 'ipfs://smoke-resume-cancel-itinerary',
    });
    const commitTx = await wallet.sendTransaction({
      to: commitCall.to,
      data: commitCall.data,
      value: commitCall.value,
    });
    const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitTx });
    const committedEvents = parseEventLogs({
      abi: SENDERO_GUEST_ESCROW_ABI,
      logs: commitReceipt.logs,
      eventName: 'BookingCommitted',
    });
    if (committedEvents.length !== 1) {
      throw new Error(
        `expected 1 BookingCommitted event from commit tx, got ${committedEvents.length}`
      );
    }
    console.log(`             commit tx emitted BookingCommitted (pre-webhook)`);

    // ─── 3. Persist paused workflow run ────────────────────────────────
    console.log('[smoke/resume-cancel] 3/5  persisting paused WorkflowRun on booking');
    const run = buildPausedRun({
      runId: crypto.randomUUID(),
      tripId,
      bookingId,
      vendorAddress,
      vendorAmountUsdc: '0.12',
      feeAmountUsdc: '0.03',
      itineraryHash,
      itineraryCID: 'ipfs://smoke-resume-cancel-itinerary',
      orderHash,
      startedAt: new Date(Date.now() - 60_000),
      pausedAt: new Date(),
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        metadata: {
          workflow: {
            workflowId: bookFlightWorkflow.id,
            runId: run.runId,
            pausedAt: run.pausedAt!.toISOString(),
            pausedStepId: run.nextStepId,
            snapshot: JSON.parse(JSON.stringify(run)),
          },
        } as object,
      },
    });

    // ─── 4. POST webhook (status=failed) → dispatcher → resume ────────
    console.log('[smoke/resume-cancel] 4/5  POST /api/webhooks/duffel (status=failed)');
    const webhookBody = JSON.stringify({
      id: `evt_smoke_cancel_${Date.now()}`,
      type: 'order.updated',
      data: { id: duffelOrderId, status: 'failed' },
    });
    const res = await fetch(`${BASE_URL}/api/webhooks/duffel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-duffel-signature': signWebhookBody(webhookBody),
      },
      body: webhookBody,
    });
    const resBody = (await res.json()) as { ok?: boolean; matched?: boolean; error?: string };
    console.log(`             status=${res.status} body=${JSON.stringify(resBody)}`);
    if (res.status !== 200 || resBody.ok !== true) {
      throw new Error(`webhook POST failed: ${res.status} ${JSON.stringify(resBody)}`);
    }
    if (resBody.matched === false) {
      throw new Error('dispatcher returned matched:false — booking lookup failed');
    }

    // ─── 5. Read resumed snapshot + submit refund + cancelTrip + sweep ─
    console.log(
      '[smoke/resume-cancel] 5/5  read resumed snapshot + submit refundBooking + cancelTrip + sweepUnspent'
    );
    const post = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { metadata: true },
    });
    const postMeta = post?.metadata as { workflow?: { snapshot?: WorkflowRun } } | null;
    const resumedSnapshot = postMeta?.workflow?.snapshot;
    if (!resumedSnapshot) throw new Error('resumed snapshot missing on booking metadata');
    if (resumedSnapshot.status !== 'completed') {
      console.error('[smoke/resume-cancel] resumed snapshot dump:');
      console.error(JSON.stringify(resumedSnapshot, null, 2));
      throw new Error(
        `expected resumed status=completed, got ${resumedSnapshot.status} (error: ${JSON.stringify(resumedSnapshot.error)})`
      );
    }
    // Verify the duffel_gate chose `otherwise` → the `cancel` step ran
    // (and by extension `confirm`/`settle_escrow` did NOT).
    const ranSteps = new Set((resumedSnapshot.trail ?? []).map(e => e.stepId));
    if (!ranSteps.has('cancel')) {
      throw new Error(`resumed trail missing 'cancel' step; got: ${[...ranSteps].join(', ')}`);
    }
    if (ranSteps.has('confirm') || ranSteps.has('settle_escrow')) {
      throw new Error(
        `failure path should NOT execute confirm/settle_escrow; got: ${[...ranSteps].join(', ')}`
      );
    }
    console.log(
      `             resumed run status=completed, branch=otherwise (cancel), trail=[${[...ranSteps].join(',')}]`
    );

    const [refundCall, sweepCall] = extractCancelCalls(resumedSnapshot);

    const refundTx = await wallet.sendTransaction({
      to: refundCall.to,
      data: refundCall.data,
      value: BigInt(refundCall.value),
    });
    const refundReceipt = await publicClient.waitForTransactionReceipt({ hash: refundTx });
    const refundedEvents = parseEventLogs({
      abi: SENDERO_GUEST_ESCROW_ABI,
      logs: refundReceipt.logs,
      eventName: 'BookingRefunded',
    });
    if (refundedEvents.length !== 1) {
      throw new Error(`expected 1 BookingRefunded event, got ${refundedEvents.length}`);
    }
    console.log(`             refundTx   = ${refundTx} (BookingRefunded emitted)`);

    // cancelTrip so sweepUnspent's `!cancelled && now<=expires` guard clears
    // without waiting on wall-clock (trip.reserved just hit 0 after refund).
    const cancelTripTx = await wallet.writeContract({
      address: ESCROW,
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'cancelTrip',
      args: [tripId],
    });
    await publicClient.waitForTransactionReceipt({ hash: cancelTripTx });
    console.log(`             cancelTrip = ${cancelTripTx}`);

    const sweepTx = await wallet.sendTransaction({
      to: sweepCall.to,
      data: sweepCall.data,
      value: BigInt(sweepCall.value),
    });
    const sweepReceipt = await publicClient.waitForTransactionReceipt({ hash: sweepTx });
    const sweptEvents = parseEventLogs({
      abi: SENDERO_GUEST_ESCROW_ABI,
      logs: sweepReceipt.logs,
      eventName: 'Swept',
    });
    if (sweptEvents.length !== 1) {
      throw new Error(`expected 1 Swept event, got ${sweptEvents.length}`);
    }
    console.log(`             sweepTx    = ${sweepTx} (Swept emitted)`);

    // ─── Assertions: escrow net-zero (full budget refunded) ──────────
    const escrowAfter = await usdcBalanceOf(ESCROW);
    const escrowDelta = escrowAfter - escrowBefore;
    console.log(
      `             escrowBefore=${escrowBefore}  escrowAfter=${escrowAfter}  delta=${escrowDelta} micro-USDC`
    );
    if (escrowDelta !== 0n) {
      throw new Error(
        `escrow did NOT roundtrip — held ${escrowDelta} micro-USDC after refund+sweep (expected 0)`
      );
    }

    console.log();
    console.log('[smoke/resume-cancel] ✓ E2E webhook → resume → cancel failure path verified');
    console.log(`[smoke/resume-cancel]   explorer: https://testnet.arcscan.app/tx/${sweepTx}`);
  } finally {
    if (bookingCreated) {
      await prisma.booking.deleteMany({ where: { tenantId: TENANT_ID } }).catch(() => void 0);
    }
    if (tripCreated) {
      await prisma.trip.deleteMany({ where: { tenantId: TENANT_ID } }).catch(() => void 0);
    }
    await prisma.webhookEvent
      .deleteMany({
        where: { provider: 'duffel', externalId: { startsWith: 'evt_smoke_cancel_' } },
      })
      .catch(() => void 0);
    if (tenantCreated) {
      await prisma.tenant.delete({ where: { id: TENANT_ID } }).catch(() => void 0);
    }
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('[smoke/resume-cancel] FAILED:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  prisma
    .$disconnect()
    .catch(() => void 0)
    .finally(() => process.exit(1));
});
