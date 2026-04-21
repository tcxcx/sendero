#!/usr/bin/env bun

/**
 * End-to-end smoke test against the live SenderoGuestEscrow on Arc Testnet.
 *
 * Exercises the full lifecycle:
 *
 *   buyer: approve USDC → createTrip      (funds escrow, generates guest link)
 *   guest: claimTrip                      (Peanut-style ephemeral-key signature)
 *   agent: reserveForBooking              (locks upper-bound)
 *   agent: commitBooking                  (releases slack)
 *   agent: confirmDuffel + settleBooking  (fans out to vendor + fee)
 *   buyer: sweepUnspent                   (returns leftover budget)
 *
 * Uses TREASURY_PRIVATE_KEY for every role in this test — the guest
 * wallet here is just a fresh throwaway EOA signing via the same key.
 * Production flow has the guest claim from an MSCA via Circle
 * Paymaster (see apps/app/app/g/page.tsx).
 *
 * Usage:
 *   bun run scripts/smoke-guest-escrow.ts
 *
 * Required env:
 *   ARC_RPC_URL, ARC_ESCROW_ADDRESS, TREASURY_PRIVATE_KEY, ARC_USDC_ADDRESS
 */

import {
  buildClaimTripCalls,
  buildGuestLink,
  computeGuestIdHash,
  encodeCommitBooking,
  encodeReserveForBooking,
  generateBookingId,
  generateClaimKeypair,
  generateTripId,
  parseGuestLink,
  SENDERO_GUEST_ESCROW_ABI,
  signClaim,
  toUsdcMicro,
  USDC_ABI,
} from '@sendero/guest';
import { cancelBookingTool } from '@sendero/tools';
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

// ─── config ───────────────────────────────────────────────────────────

const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);
const ESCROW = (process.env.ARC_ESCROW_ADDRESS ??
  process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
  '') as Address;
const USDC = (process.env.ARC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as Address;
const PK = (process.env.TREASURY_PRIVATE_KEY ?? '') as Hex;

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error('[smoke] TREASURY_PRIVATE_KEY missing or malformed');
  process.exit(1);
}
if (!ESCROW || !/^0x[0-9a-fA-F]{40}$/.test(ESCROW)) {
  console.error('[smoke] ARC_ESCROW_ADDRESS missing or malformed');
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

// ─── smoke test ───────────────────────────────────────────────────────

async function main() {
  const budget = toUsdcMicro('0.50');
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log(`[smoke] operator      = ${operator.address}`);
  console.log(`[smoke] escrow        = ${ESCROW}`);
  console.log(`[smoke] usdc          = ${USDC}`);
  console.log(`[smoke] rpc           = ${RPC}`);
  console.log();

  // 0. sanity — escrow USDC + state
  const [escrowUsdc, owner, knownOperator] = await Promise.all([
    publicClient.readContract({
      address: ESCROW,
      abi: [
        {
          type: 'function',
          name: 'USDC',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        },
      ] as const,
      functionName: 'USDC',
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: [
        {
          type: 'function',
          name: 'owner',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        },
      ] as const,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: [
        {
          type: 'function',
          name: 'operator',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        },
      ] as const,
      functionName: 'operator',
    }),
  ]);
  console.log('[smoke] escrow.USDC()     =', escrowUsdc);
  console.log('[smoke] escrow.owner()    =', owner);
  console.log('[smoke] escrow.operator() =', knownOperator);
  if ((knownOperator as string).toLowerCase() !== operator.address.toLowerCase()) {
    console.warn(
      '[smoke] ⚠  operator mismatch — reserve/commit/settle calls will revert onlyOperator.'
    );
  }
  console.log();

  // 1. approve USDC
  console.log('[smoke] 1/6  approve USDC → escrow');
  const approveTx = await wallet.writeContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'approve',
    args: [ESCROW, budget],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log(`             tx ${approveTx}  block ${approveReceipt.blockNumber}`);
  console.log();

  // 2. createTrip
  const tripId = generateTripId();
  const claimKp = generateClaimKeypair();
  console.log('[smoke] 2/6  createTrip');
  console.log(`             tripId     = ${tripId}`);
  console.log(`             claimAddr  = ${claimKp.pubKey20}`);
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
      'ipfs://smoke-test',
      BigInt(process.env.SENDERO_AGENT_TOKEN_ID ?? '2286'),
      zeroHash, // claimCodeHash = 0 → no 2FA for the smoke test
    ],
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  const createdLogs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: createReceipt.logs,
    eventName: 'TripCreated',
  });
  console.log(`             tx ${createTx}  block ${createReceipt.blockNumber}`);
  console.log(`             TripCreated events: ${createdLogs.length}`);
  const guestLink = buildGuestLink({
    origin: process.env.NEXT_PUBLIC_SENDERO_GUEST_LINK_ORIGIN ?? 'https://sendero.travel',
    tripId,
    claimPrivateKey: claimKp.privateKey,
  });
  console.log(`             guestLink  = ${guestLink}`);
  console.log();

  // 3. guest claims — the smoke test uses the same operator EOA as the
  //    "guest wallet" so we can round-trip without a second key. In
  //    production /g mints a new MSCA and uses that.
  console.log('[smoke] 3/6  claimTrip as guest (signing Peanut-style with ephemeral key)');
  const parts = parseGuestLink(guestLink);
  if (!parts) throw new Error('parseGuestLink failed');
  const signature = await signClaim({
    claimPrivateKey: parts.claimPrivateKey,
    chainId: CHAIN_ID,
    escrow: ESCROW,
    tripId: parts.tripId,
    guestWallet: operator.address,
  });
  const [claimCall] = buildClaimTripCalls({
    escrow: ESCROW,
    tripId: parts.tripId,
    guestWallet: operator.address,
    signature,
    // trip created without 2FA → empty preimage
    claimCodePreimage: '0x',
  });
  const claimTx = await wallet.sendTransaction({
    to: claimCall.to,
    data: claimCall.data,
    value: claimCall.value,
  });
  const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });
  console.log(`             tx ${claimTx}  block ${claimReceipt.blockNumber}`);
  console.log();

  // 4. reserveForBooking
  console.log('[smoke] 4/6  reserveForBooking');
  const bookingId = generateBookingId();
  const upperBound = toUsdcMicro('0.40');
  console.log(`             bookingId  = ${bookingId}`);
  console.log(`             upperBound = ${upperBound} micro`);
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
  const reserveReceipt = await publicClient.waitForTransactionReceipt({ hash: reserveTx });
  console.log(`             tx ${reserveTx}  block ${reserveReceipt.blockNumber}`);
  console.log();

  // 5. commitBooking
  console.log('[smoke] 5/6  commitBooking');
  const vendor = operator.address;
  const vendorAmount = toUsdcMicro('0.30');
  const feeAmount = toUsdcMicro('0.05');
  const itineraryHash = computeGuestIdHash({ email: 'smoke@sendero.test', nonce: zeroHash });
  const commitCall = encodeCommitBooking({
    escrow: ESCROW,
    bookingId,
    vendorAmount,
    feeAmount,
    vendor,
    itineraryHash,
    itineraryCID: 'ipfs://smoke-itinerary',
  });
  const commitTx = await wallet.sendTransaction({
    to: commitCall.to,
    data: commitCall.data,
    value: commitCall.value,
  });
  const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitTx });
  console.log(`             tx ${commitTx}  block ${commitReceipt.blockNumber}`);
  console.log();

  // 6. confirmDuffel + settleBooking
  console.log('[smoke] 6/6  confirmDuffel + settleBooking');
  const duffelHash = ('0x' +
    Buffer.from(`duffel-smoke-${Date.now()}`).toString('hex').padEnd(64, '0')) as Hex;
  const confirmTx = await wallet.writeContract({
    address: ESCROW,
    abi: SENDERO_GUEST_ESCROW_ABI,
    functionName: 'confirmDuffel',
    args: [bookingId, duffelHash.slice(0, 66) as Hex],
  });
  await publicClient.waitForTransactionReceipt({ hash: confirmTx });
  const settleTx = await wallet.writeContract({
    address: ESCROW,
    abi: SENDERO_GUEST_ESCROW_ABI,
    functionName: 'settleBooking',
    args: [bookingId],
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTx });
  console.log(`             confirm tx ${confirmTx}`);
  console.log(`             settle  tx ${settleTx}  block ${settleReceipt.blockNumber}`);
  console.log();

  // 7. sweepUnspent (optional cleanup)
  console.log('[smoke] 7/7  sweepUnspent');
  try {
    const sweepTx = await wallet.writeContract({
      address: ESCROW,
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'sweepUnspent',
      args: [tripId],
    });
    const sweepReceipt = await publicClient.waitForTransactionReceipt({ hash: sweepTx });
    console.log(`             tx ${sweepTx}  block ${sweepReceipt.blockNumber}`);
  } catch (err) {
    console.log('             (sweep deferred — trip still within the hot window)');
    console.log('             ', err instanceof Error ? err.message : err);
  }

  console.log();
  console.log('[smoke] ✔  full lifecycle succeeded against live SenderoGuestEscrow');
  console.log(`[smoke]     explorer: https://testnet.arcscan.app/address/${ESCROW}#events`);

  // ─── cancel-path scenario ────────────────────────────────────────────
  await cancelScenario();
}

// ─── helpers ──────────────────────────────────────────────────────────

async function usdcBalanceOf(addr: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [addr],
  }) as Promise<bigint>;
}

/**
 * Failure-path smoke: create → claim → reserve → commit → cancel_booking
 * (refundBooking + sweepUnspent) with a short-expiry trip so sweep can
 * run in the same session. Exercises the `cancel_booking` tool's encoded
 * calls against the live escrow. We also invoke cancelTrip between the
 * two refund+sweep calls so sweepUnspent's `!cancelled && now<=expires`
 * guard passes without having to wait on wall-clock expiry.
 */
async function cancelScenario() {
  console.log();
  console.log('[smoke] ═══ cancel-path scenario ══════════════════════════════');

  const budget = toUsdcMicro('0.20');
  // 60s expiry — long enough for all our txs to land (createTrip, claim,
  // reserve, commit, refund, cancelTrip, sweep is ~7 txs at 3s blocks).
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 120);

  // Snapshot escrow balance — USDC is the gas token on Arc so the
  // buyer EOA balance can't be used as a clean proxy (each tx burns
  // gas). The escrow contract's USDC balance is a clean measure.
  const escrowBefore = await usdcBalanceOf(ESCROW);
  const balBefore = await usdcBalanceOf(operator.address);
  console.log(`[smoke] buyer balance before  = ${balBefore} micro`);
  console.log(`[smoke] escrow balance before = ${escrowBefore} micro`);

  // 1. approve + createTrip
  console.log('[smoke] C1/5  approve + createTrip (budget=0.20 USDC)');
  const approveTx = await wallet.writeContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'approve',
    args: [ESCROW, budget],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const tripId = generateTripId();
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
      'ipfs://smoke-cancel',
      BigInt(process.env.SENDERO_AGENT_TOKEN_ID ?? '2286'),
      zeroHash,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  console.log(`             tripId = ${tripId}  createTx = ${createTx}`);

  // 2. guest claims (same EOA acts as guest, matching happy-path smoke)
  console.log('[smoke] C2/5  claimTrip');
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

  // 3. reserve + commit 0.15 USDC (fits inside the 0.20 budget)
  console.log('[smoke] C3/5  reserveForBooking + commitBooking (0.15 USDC)');
  const bookingId = generateBookingId();
  const upperBound = toUsdcMicro('0.18');
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

  const vendorAmount = toUsdcMicro('0.12');
  const feeAmount = toUsdcMicro('0.03');
  const commitCall = encodeCommitBooking({
    escrow: ESCROW,
    bookingId,
    vendorAmount,
    feeAmount,
    vendor: operator.address,
    itineraryHash: computeGuestIdHash({ email: 'cancel@sendero.test', nonce: zeroHash }),
    itineraryCID: 'ipfs://smoke-cancel-itinerary',
  });
  const commitTx = await wallet.sendTransaction({
    to: commitCall.to,
    data: commitCall.data,
    value: commitCall.value,
  });
  await publicClient.waitForTransactionReceipt({ hash: commitTx });
  console.log(`             booking = ${bookingId}  committed=0.15 USDC`);

  // 4. cancel_booking tool → refundBooking + sweepUnspent
  //    Inject a cancelTrip between them so sweep's expiry guard clears
  //    without having to wait on wall-clock.
  console.log('[smoke] C4/5  cancel_booking → refundBooking (+ cancelTrip) + sweepUnspent');
  const cancelResult = (await cancelBookingTool.handler({
    bookingId,
    tripId,
    reason: 'duffel_failed',
    escrowAddress: ESCROW,
  })) as { onchainCalls: Array<{ to: Address; data: Hex; value: string }> };
  const [refundCall, sweepCall] = cancelResult.onchainCalls;

  const refundTx = await wallet.sendTransaction({
    to: refundCall.to,
    data: refundCall.data,
    value: BigInt(refundCall.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: refundTx });

  // After refundBooking, trip.reserved == 0 so cancelTrip is callable.
  const cancelTripTx = await wallet.writeContract({
    address: ESCROW,
    abi: SENDERO_GUEST_ESCROW_ABI,
    functionName: 'cancelTrip',
    args: [tripId],
  });
  await publicClient.waitForTransactionReceipt({ hash: cancelTripTx });

  const sweepTx = await wallet.sendTransaction({
    to: sweepCall.to,
    data: sweepCall.data,
    value: BigInt(sweepCall.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: sweepTx });
  console.log(`             refundTx   = ${refundTx}`);
  console.log(`             cancelTrip = ${cancelTripTx}`);
  console.log(`             sweepTx    = ${sweepTx}`);

  // 5. assert escrow returned the full budget
  console.log('[smoke] C5/5  assert buyer refunded');
  const escrowAfter = await usdcBalanceOf(ESCROW);
  const balAfter = await usdcBalanceOf(operator.address);
  // Escrow's USDC balance should be unchanged net-net: the budget went
  // in via createTrip and fully came back out via sweepUnspent.
  const escrowDelta = escrowAfter - escrowBefore;
  console.log(`             escrowBefore = ${escrowBefore}`);
  console.log(`             escrowAfter  = ${escrowAfter}`);
  console.log(`             escrowDelta  = ${escrowDelta} micro-USDC`);
  console.log(`             balBefore    = ${balBefore}`);
  console.log(`             balAfter     = ${balAfter}`);
  console.log(
    `             buyerDelta   = ${balAfter - balBefore} micro-USDC (negative expected — USDC is the gas token on Arc)`
  );
  if (escrowDelta !== 0n) {
    throw new Error(
      `cancel scenario did NOT roundtrip: escrow held ${escrowDelta} micro-USDC after refund+sweep (expected 0)`
    );
  }
  console.log('[smoke] ✓ cancel refunded buyer (escrow net-zero, full budget returned)');
}

main().catch(err => {
  console.error('[smoke] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
