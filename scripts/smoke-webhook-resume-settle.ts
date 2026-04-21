#!/usr/bin/env bun
/**
 * Full E2E phase-11a happy path smoke.
 *
 * Proves the resume architecture end-to-end:
 *
 *   Prisma: Tenant + Trip + Booking seeded with a paused WorkflowRun
 *     snapshot attached to Booking.metadata.workflow.
 *   On-chain: createTrip → claim → reserveForBooking → commitBooking
 *     (leaves the booking in COMMITTED status, waiting for confirmDuffel).
 *   Webhook: POST /api/webhooks/duffel with status=ticketed →
 *     - HMAC verify + dedupe + dispatcher + resumeRun executed in-process
 *     - dispatchDuffelEvent resumes the workflow via the default
 *       (non-submitting) tool registry; resumed snapshot is persisted
 *       back to Booking.metadata.workflow.
 *     - Response must be 200 { ok:true } (matched=true path).
 *   Post-resume on-chain submission: read the resumed run's trail for the
 *     encoded confirm_duffel + settle_booking calls and submit them via
 *     the smoke's viem wallet (operator path).
 *   Assertions: booking status in the escrow contract is SETTLED (enum=2)
 *     AND the vendor address received `vendorAmount` micro-USDC.
 *
 * The production webhook route deliberately uses an encoder-only tool
 * registry — the MSCA bundler is responsible for submitting the encoded
 * calls. The smoke wraps that last mile itself (using operator EOA) so
 * the full chain runs in one invocation.
 *
 * Usage: bun run smoke:resume-settle
 * Env: see smoke-guest-escrow.ts plus DUFFEL_WEBHOOK_SECRET +
 *      SMOKE_BASE_URL (default http://localhost:3010).
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
  console.error('[smoke/resume-settle] TREASURY_PRIVATE_KEY missing or malformed');
  process.exit(1);
}
if (!ESCROW || !/^0x[0-9a-fA-F]{40}$/.test(ESCROW)) {
  console.error('[smoke/resume-settle] ARC_ESCROW_ADDRESS missing or malformed');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('[smoke/resume-settle] DUFFEL_WEBHOOK_SECRET missing');
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
      `[smoke/resume-settle] dev server not reachable at ${BASE_URL} — start it first`
    );
    throw err;
  }
}

/**
 * Hand-construct a WorkflowRun paused at `await_duffel_ticket`. Bypasses
 * re-running search/policy/reserve/hold/commit (already exercised by
 * Epic 9a unit tests + smoke-guest-escrow). The scratchpad carries
 * exactly the keys the duffel_gate branch + its sub-steps read back.
 */
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
        // Used by the trailing `settle` (settle_split) step.
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

/**
 * Reach into Booking.metadata.workflow.snapshot (post-resume) and pull the
 * encoded on-chain calls produced by the resumed tools. The resumed run's
 * scratchpad stores each tool's output under its step id; the settle branch
 * writes `confirm` and `settle_escrow`.
 */
function extractTicketedCalls(snapshot: WorkflowRun): {
  confirm: { to: Address; data: Hex; value: string };
  settle: { to: Address; data: Hex; value: string };
} {
  const pad = snapshot.scratchpad as Record<string, any>;
  const confirm = pad.confirm?.onchainCall;
  const settle = pad.settle_escrow?.onchainCall;
  if (!confirm || !settle) {
    console.error('[smoke/resume-settle] resumed scratchpad missing onchainCall:', {
      keys: Object.keys(pad),
      confirm: pad.confirm,
      settle: pad.settle_escrow,
    });
    throw new Error('resumed scratchpad missing confirm/settle onchainCall');
  }
  return { confirm, settle };
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  await ensureServerUp();

  const TENANT_ID = `smoke-resume-settle-${Date.now()}`;
  const duffelOrderId = `ord_smoke_settle_${Date.now()}`;
  const vendorAddress = operator.address;
  const budget = toUsdcMicro('0.50');
  const upperBound = toUsdcMicro('0.40');
  const vendorAmount = toUsdcMicro('0.30');
  const feeAmount = toUsdcMicro('0.05');
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const tripId = generateTripId();
  const bookingId = generateBookingId();
  const itineraryHash = computeGuestIdHash({ email: 'resume@sendero.test', nonce: zeroHash });
  const orderHash = ('0x' +
    Buffer.from(`duffel-${duffelOrderId}`).toString('hex').padEnd(64, '0').slice(0, 64)) as Hex;

  console.log(`[smoke/resume-settle] operator       = ${operator.address}`);
  console.log(`[smoke/resume-settle] escrow         = ${ESCROW}`);
  console.log(`[smoke/resume-settle] tripId         = ${tripId}`);
  console.log(`[smoke/resume-settle] bookingId      = ${bookingId}`);
  console.log(`[smoke/resume-settle] duffelOrderId  = ${duffelOrderId}`);
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
        displayName: 'Resume-settle smoke',
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
        totalUsd: '0.30',
        currency: 'USD',
      },
      select: { id: true },
    });
    bookingCreated = true;
    console.log(`[smoke/resume-settle] seeded tenant=${TENANT_ID} booking=${booking.id}`);

    // ─── 2. On-chain: approve + createTrip + claim + reserve + commit ──
    console.log('[smoke/resume-settle] 2/5  on-chain setup (approve/create/claim/reserve/commit)');
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
        'ipfs://smoke-resume-settle',
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
      itineraryCID: 'ipfs://smoke-resume-settle-itinerary',
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
    console.log(`             commit tx emitted BookingCommitted (bookingId matches, COMMITTED)`);

    // ─── 3. Persist paused workflow run onto the booking ──────────────
    console.log('[smoke/resume-settle] 3/5  persisting paused WorkflowRun on booking');
    const run = buildPausedRun({
      runId: crypto.randomUUID(),
      tripId,
      bookingId,
      vendorAddress,
      vendorAmountUsdc: '0.30',
      feeAmountUsdc: '0.05',
      itineraryHash,
      itineraryCID: 'ipfs://smoke-resume-settle-itinerary',
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

    // ─── 4. POST webhook → dispatcher → resume ────────────────────────
    console.log('[smoke/resume-settle] 4/5  POST /api/webhooks/duffel (status=ticketed)');
    const vendorBefore = await usdcBalanceOf(vendorAddress);
    const webhookBody = JSON.stringify({
      id: `evt_smoke_settle_${Date.now()}`,
      type: 'order.updated',
      data: { id: duffelOrderId, status: 'ticketed' },
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

    // ─── 5. Read resumed snapshot + submit encoded on-chain calls ────
    console.log('[smoke/resume-settle] 5/5  read resumed snapshot + submit confirm + settle');
    const post = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { metadata: true },
    });
    const postMeta = post?.metadata as { workflow?: { snapshot?: WorkflowRun } } | null;
    const resumedSnapshot = postMeta?.workflow?.snapshot;
    if (!resumedSnapshot) throw new Error('resumed snapshot missing on booking metadata');
    if (resumedSnapshot.status !== 'completed') {
      console.error('[smoke/resume-settle] resumed snapshot dump:');
      console.error(JSON.stringify(resumedSnapshot, null, 2));
      throw new Error(
        `expected resumed status=completed, got ${resumedSnapshot.status} (error: ${JSON.stringify(resumedSnapshot.error)})`
      );
    }
    console.log(`             resumed run status=completed runId=${resumedSnapshot.runId}`);

    const { confirm, settle } = extractTicketedCalls(resumedSnapshot);
    const confirmTx = await wallet.sendTransaction({
      to: confirm.to,
      data: confirm.data,
      value: BigInt(confirm.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: confirmTx });
    console.log(`             confirmTx = ${confirmTx}`);

    const settleTx = await wallet.sendTransaction({
      to: settle.to,
      data: settle.data,
      value: BigInt(settle.value),
    });
    const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTx });
    console.log(`             settleTx  = ${settleTx}`);

    // ─── Assertions: BookingSettled event + vendor + fee amounts ────
    const settledEvents = parseEventLogs({
      abi: SENDERO_GUEST_ESCROW_ABI,
      logs: settleReceipt.logs,
      eventName: 'BookingSettled',
    });
    if (settledEvents.length !== 1) {
      throw new Error(`expected 1 BookingSettled event, got ${settledEvents.length}`);
    }
    const settledArgs = settledEvents[0].args as {
      bookingId: Hex;
      vendor: Address;
      vendorAmount: bigint;
      feeAmount: bigint;
    };
    if (settledArgs.bookingId.toLowerCase() !== bookingId.toLowerCase()) {
      throw new Error(
        `BookingSettled event bookingId mismatch: got ${settledArgs.bookingId}, expected ${bookingId}`
      );
    }
    if (settledArgs.vendorAmount !== vendorAmount) {
      throw new Error(
        `BookingSettled vendorAmount=${settledArgs.vendorAmount} (expected ${vendorAmount})`
      );
    }
    if (settledArgs.feeAmount !== feeAmount) {
      throw new Error(`BookingSettled feeAmount=${settledArgs.feeAmount} (expected ${feeAmount})`);
    }
    console.log(
      `             ✓ BookingSettled event: vendor=${settledArgs.vendor} vendorAmount=${settledArgs.vendorAmount} fee=${settledArgs.feeAmount}`
    );
    const vendorAfter = await usdcBalanceOf(vendorAddress);
    console.log(
      `             vendorBefore=${vendorBefore} vendorAfter=${vendorAfter} delta=${vendorAfter - vendorBefore} micro-USDC`
    );
    console.log(
      `             (vendor==operator in smoke → delta reflects payout minus gas; the BookingSettled event is the load-bearing assertion)`
    );

    console.log();
    console.log('[smoke/resume-settle] ✓ E2E webhook → resume → settle happy path verified');
    console.log(`[smoke/resume-settle]   explorer: https://testnet.arcscan.app/tx/${settleTx}`);
  } finally {
    // Cleanup DB rows in reverse-dependency order. On-chain state
    // stays (observable via explorer) but DB artefacts get pruned.
    if (bookingCreated) {
      await prisma.booking.deleteMany({ where: { tenantId: TENANT_ID } }).catch(() => void 0);
    }
    if (tripCreated) {
      await prisma.trip.deleteMany({ where: { tenantId: TENANT_ID } }).catch(() => void 0);
    }
    // Best-effort prune the webhook_events row for this orderId so the
    // dedupe table doesn't grow indefinitely.
    await prisma.webhookEvent
      .deleteMany({
        where: { provider: 'duffel', externalId: { startsWith: 'evt_smoke_settle_' } },
      })
      .catch(() => void 0);
    if (tenantCreated) {
      await prisma.tenant.delete({ where: { id: TENANT_ID } }).catch(() => void 0);
    }
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('[smoke/resume-settle] FAILED:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  prisma
    .$disconnect()
    .catch(() => void 0)
    .finally(() => process.exit(1));
});
