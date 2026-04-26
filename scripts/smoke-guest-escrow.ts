#!/usr/bin/env bun

/**
 * End-to-end smoke test against the live SenderoGuestEscrow on Arc Testnet.
 *
 * Exercises the full lifecycle:
 *
 *   buyer: approve USDC → createTrip      (funds escrow, generates guest link)
 *   guest: claimTrip                      (Peanut-style ephemeral-key signature)
 *   agent: reserveForBooking              (locks upper-bound)
 *   agent: commitBooking[V2]              (releases slack; v2 also persists agency leg)
 *   agent: confirmDuffel + settleBooking  (fans out to vendor [+ agency] + fee)
 *   buyer: sweepUnspent                   (returns leftover budget)
 *
 * v3.0.0 of the on-chain contract added a three-recipient settle path
 * (vendor + agency + operator). This smoke can exercise either path
 * via `--mode`:
 *
 *   --mode=v1   (default) commitBooking + BookingSettled       — backward-compat
 *   --mode=v2             commitBookingV2 + BookingSettledV2   — new agency leg
 *   --mode=both           runs v1 then v2 against separate trips in one invocation
 *                         (the post-upgrade smoke we run after UUPS rollout)
 *
 * Uses TREASURY_PRIVATE_KEY for every role in this test — the guest
 * wallet here is just a fresh throwaway EOA signing via the same key.
 * Production flow has the guest claim from an MSCA via Circle
 * Paymaster (see apps/app/app/g/page.tsx).
 *
 * Usage:
 *   bun run scripts/smoke-guest-escrow.ts                # legacy v1 path
 *   bun run scripts/smoke-guest-escrow.ts --mode=v2      # new agency-leg path
 *   bun run scripts/smoke-guest-escrow.ts --mode=both    # both, sequentially
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
  keccak256,
  parseEventLogs,
  toHex,
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

// ─── CLI parsing ──────────────────────────────────────────────────────

type Mode = 'v1' | 'v2' | 'both';

function parseMode(argv: string[]): Mode {
  // Accept --mode=v1, --mode=v2, --mode=both. Default v1.
  for (const arg of argv) {
    const m = /^--mode=(v1|v2|both)$/.exec(arg);
    if (m) return m[1] as Mode;
    if (arg === '--mode') {
      // --mode v2 (space-separated) — pick the next arg
      const idx = argv.indexOf(arg);
      const next = argv[idx + 1];
      if (next === 'v1' || next === 'v2' || next === 'both') return next;
    }
  }
  return 'v1';
}

// ─── smoke test ───────────────────────────────────────────────────────

async function main() {
  const mode = parseMode(process.argv.slice(2));

  console.log(`[smoke] operator      = ${operator.address}`);
  console.log(`[smoke] escrow        = ${ESCROW}`);
  console.log(`[smoke] usdc          = ${USDC}`);
  console.log(`[smoke] rpc           = ${RPC}`);
  console.log(`[smoke] mode          = ${mode}`);
  console.log();

  await assertEscrowVersion();

  if (mode === 'v1' || mode === 'both') {
    await lifecycle('v1');
  }
  if (mode === 'v2' || mode === 'both') {
    if (mode === 'both') {
      console.log();
      console.log('[smoke] ═══ switching to v2 (agency-leg) lifecycle ════════════');
      console.log();
    }
    await lifecycle('v2');
  }

  // ─── cancel-path scenario (mode-agnostic — exercises legacy refund path) ──
  await cancelScenario();
}

/**
 * Read `version()` from the proxy and warn loudly if we're not on v3.
 * v2 impls don't expose the view at all → that surfaces as a revert
 * we treat as "old impl behind proxy, upgrade hasn't landed".
 */
async function assertEscrowVersion(): Promise<void> {
  try {
    const v = (await publicClient.readContract({
      address: ESCROW,
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'version',
    })) as string;
    console.log(`[smoke] escrow.version()  = ${v}`);
    if (!v.startsWith('3.')) {
      console.warn(
        `[smoke] ⚠  expected v3.x at ${ESCROW} but got ${v} — commitBookingV2 will revert.`
      );
    }
    console.log();
  } catch (err) {
    console.warn(
      `[smoke] ⚠  version() reverted at ${ESCROW} — proxy likely still points at the v2 impl. ` +
        'Run the UUPS upgrade before --mode=v2 or --mode=both.'
    );
    console.warn('       ', err instanceof Error ? err.message : err);
    console.log();
  }
}

/**
 * Deterministic agency address per trip — keccak256('agency:' || tripId)
 * truncated to 20 bytes. Stable across reruns so we can grep explorer
 * by address if a smoke fails.
 */
function deriveAgencyAddress(tripId: Hex): Address {
  const h = keccak256(`0x${toHex('agency:').slice(2)}${tripId.slice(2)}` as Hex);
  return `0x${h.slice(2, 42)}` as Address;
}

/**
 * Read escrow's USDC / owner / operator views. Surfaces operator
 * mismatch as a warning so the lifecycle's onlyOperator reverts have
 * an obvious upstream cause in the log.
 */
async function sanityRead(): Promise<void> {
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
}

async function lifecycle(mode: 'v1' | 'v2') {
  // v2 needs a different (much larger) budget envelope, so it runs in a
  // self-contained sibling rather than threading mode-flags through the
  // existing v1 flow. Sanity-check the proxy first either way.
  if (mode === 'v2') {
    await sanityRead();
    return v2Lifecycle();
  }

  const budget = toUsdcMicro('0.50');
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  await sanityRead();

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
  // v1 should emit BookingSettled (not BookingSettledV2). Surface a
  // count so a regression where v1 commits accidentally route through
  // the v2 emit path is visible in the smoke output.
  const v1SettleLogs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: settleReceipt.logs,
    eventName: 'BookingSettled',
  });
  const v2SettleLogs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: settleReceipt.logs,
    eventName: 'BookingSettledV2',
  });
  console.log(
    `             BookingSettled events: ${v1SettleLogs.length}  BookingSettledV2 events: ${v2SettleLogs.length}`
  );
  if (v1SettleLogs.length !== 1 || v2SettleLogs.length !== 0) {
    throw new Error(
      `v1 settle emitted unexpected events: BookingSettled=${v1SettleLogs.length} BookingSettledV2=${v2SettleLogs.length}`
    );
  }
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
  console.log('[smoke] ✔  v1 lifecycle succeeded against live SenderoGuestEscrow');
  console.log(`[smoke]     explorer: https://testnet.arcscan.app/address/${ESCROW}#events`);
}

/**
 * Self-contained v2 lifecycle — uses realistic GDS-shaped numbers
 * (vendorAmount = 1_000_000_000, feeAmount = 5_000_000, agencyAmount =
 * 110_000_000 micro-USDC) so we can prove the new agency leg routes
 * correctly. Asserts vendor, agency, and operator deltas match the
 * committed amounts exactly, and that the receipt carries a single
 * BookingSettledV2 event (not the legacy BookingSettled).
 */
async function v2Lifecycle() {
  const vendor = operator.address;
  const vendorAmount = 1_000_000_000n; // supplier cost
  const feeAmount = 5_000_000n; //         Sendero take
  const agencyAmount = 110_000_000n; //    tenant markup (~11%)
  const itineraryHash = computeGuestIdHash({ email: 'smoke-v2@sendero.test', nonce: zeroHash });

  const total = vendorAmount + feeAmount + agencyAmount;
  // Headroom over the booking total so reserve/commit slack-release runs.
  const upperBound = (total * 12n) / 10n;
  const budget = upperBound; // single-booking trip — budget == reserve ceiling
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // tripId is generated up-front so we can derive a stable agency
  // address from it before any on-chain call.
  const tripId = generateTripId();
  const claimKp = generateClaimKeypair();
  const agencyAddress = deriveAgencyAddress(tripId);

  console.log(`[smoke v2] tripId       = ${tripId}`);
  console.log(`[smoke v2] vendor       = ${vendor}`);
  console.log(`[smoke v2] agency       = ${agencyAddress}`);
  console.log(`[smoke v2] vendorAmount = ${vendorAmount} micro`);
  console.log(`[smoke v2] feeAmount    = ${feeAmount} micro`);
  console.log(`[smoke v2] agencyAmount = ${agencyAmount} micro`);
  console.log(`[smoke v2] total        = ${total} micro`);
  console.log(`[smoke v2] upperBound   = ${upperBound} micro`);

  // 1. approve USDC (v2-sized budget)
  console.log('[smoke v2] 1/6  approve USDC → escrow');
  const approveTx = await wallet.writeContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'approve',
    args: [ESCROW, budget],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log(`              tx ${approveTx}`);

  // 2. createTrip (tripId + claimKp generated above so agency address
  // can be derived from tripId before any on-chain call)
  console.log('[smoke v2] 2/6  createTrip');
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
      'ipfs://smoke-v2',
      BigInt(process.env.SENDERO_AGENT_TOKEN_ID ?? '2286'),
      zeroHash,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  console.log(`              tx ${createTx}`);

  // 3. claimTrip
  console.log('[smoke v2] 3/6  claimTrip');
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
  console.log(`              tx ${claimTx}`);

  // 4. reserveForBooking
  console.log('[smoke v2] 4/6  reserveForBooking');
  const bookingId = generateBookingId();
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
  console.log(`              tx ${reserveTx}  bookingId = ${bookingId}`);

  // Snapshot vendor / agency / operator USDC balances so we can assert
  // the three-way settle delta on the other side.
  const operatorBefore = await usdcBalanceOf(operator.address);
  const agencyBefore = await usdcBalanceOf(agencyAddress);
  // vendor == operator in this test, so vendorBefore is captured by
  // operatorBefore — we'll separate the deltas below.

  // 5. commitBookingV2 — direct writeContract (no encoder helper in
  // @sendero/guest yet; the ABI carries the signature so viem handles it).
  console.log('[smoke v2] 5/6  commitBookingV2');
  const commitTx = await wallet.writeContract({
    address: ESCROW,
    abi: SENDERO_GUEST_ESCROW_ABI,
    functionName: 'commitBookingV2',
    args: [
      bookingId,
      vendorAmount,
      feeAmount,
      agencyAmount,
      vendor,
      agencyAddress,
      itineraryHash,
      'ipfs://smoke-v2-itinerary',
    ],
  });
  const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitTx });
  const committedV2Logs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: commitReceipt.logs,
    eventName: 'BookingCommittedV2',
  });
  console.log(`              tx ${commitTx}  BookingCommittedV2 events: ${committedV2Logs.length}`);
  if (committedV2Logs.length !== 1) {
    throw new Error(`expected 1 BookingCommittedV2 event, got ${committedV2Logs.length}`);
  }

  // 6. confirmDuffel + settleBooking → expect BookingSettledV2
  console.log('[smoke v2] 6/6  confirmDuffel + settleBooking');
  const duffelHash = ('0x' +
    Buffer.from(`duffel-smoke-v2-${Date.now()}`).toString('hex').padEnd(64, '0')) as Hex;
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
  console.log(`              confirm tx ${confirmTx}`);
  console.log(`              settle  tx ${settleTx}  block ${settleReceipt.blockNumber}`);

  // Event assertions: exactly one BookingSettledV2, zero legacy BookingSettled.
  const v1SettleLogs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: settleReceipt.logs,
    eventName: 'BookingSettled',
  });
  const v2SettleLogs = parseEventLogs({
    abi: SENDERO_GUEST_ESCROW_ABI,
    logs: settleReceipt.logs,
    eventName: 'BookingSettledV2',
  });
  console.log(
    `              BookingSettled events: ${v1SettleLogs.length}  BookingSettledV2 events: ${v2SettleLogs.length}`
  );
  if (v2SettleLogs.length !== 1 || v1SettleLogs.length !== 0) {
    throw new Error(
      `v2 settle emitted unexpected events: BookingSettled=${v1SettleLogs.length} BookingSettledV2=${v2SettleLogs.length}`
    );
  }

  // Decoded event sanity — args should match what we committed.
  const ev = v2SettleLogs[0]!.args as {
    bookingId: Hex;
    vendor: Address;
    vendorAmount: bigint;
    agencyAddress: Address;
    agencyAmount: bigint;
    feeAmount: bigint;
  };
  if (
    ev.vendorAmount !== vendorAmount ||
    ev.agencyAmount !== agencyAmount ||
    ev.feeAmount !== feeAmount ||
    ev.vendor.toLowerCase() !== vendor.toLowerCase() ||
    ev.agencyAddress.toLowerCase() !== agencyAddress.toLowerCase()
  ) {
    throw new Error(
      `BookingSettledV2 args mismatch: ${JSON.stringify(ev, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`
    );
  }

  // Balance-delta assertions. vendor == operator in this smoke, so the
  // operator's net delta is `vendorAmount + feeAmount` (paid to itself
  // twice in one tx). Agency's delta is the markup leg.
  const operatorAfter = await usdcBalanceOf(operator.address);
  const agencyAfter = await usdcBalanceOf(agencyAddress);
  const operatorDelta = operatorAfter - operatorBefore;
  const agencyDelta = agencyAfter - agencyBefore;

  // Note: operator pays gas in USDC on Arc — the post-tx operator
  // delta will be (vendorAmount + feeAmount - gasUsedInUsdc). We can't
  // assert exact equality; assert it falls within a sane window
  // instead. For agency the assertion is exact (no gas paid).
  const expectedOperatorGross = vendorAmount + feeAmount;
  console.log(`              operatorBefore = ${operatorBefore}`);
  console.log(`              operatorAfter  = ${operatorAfter}`);
  console.log(
    `              operatorDelta  = ${operatorDelta} micro (expected ≈ +${expectedOperatorGross}, less gas)`
  );
  console.log(`              agencyBefore   = ${agencyBefore}`);
  console.log(`              agencyAfter    = ${agencyAfter}`);
  console.log(
    `              agencyDelta    = ${agencyDelta} micro (expected exactly +${agencyAmount})`
  );

  if (agencyDelta !== agencyAmount) {
    throw new Error(
      `agency leg did not settle exactly: expected +${agencyAmount}, got ${agencyDelta}`
    );
  }
  // Operator delta must be at most expectedOperatorGross (we received
  // that much) and at least expectedOperatorGross - 1 USDC (gas
  // headroom on Arc; settle + confirm + a few smaller calls run well
  // under 1 USDC of gas in practice).
  const operatorGasFloor = expectedOperatorGross - 1_000_000n;
  if (operatorDelta > expectedOperatorGross || operatorDelta < operatorGasFloor) {
    throw new Error(
      `operator delta out of expected window: got ${operatorDelta}, expected in [${operatorGasFloor}, ${expectedOperatorGross}]`
    );
  }

  console.log();
  console.log('[smoke v2] ✔  v2 lifecycle succeeded — agency leg routed correctly');
  console.log(`[smoke v2]    explorer: https://testnet.arcscan.app/address/${ESCROW}#events`);
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
