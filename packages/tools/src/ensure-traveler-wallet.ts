/**
 * `ensureTravelerWallet({ userId })` — lazy DCW provisioning.
 *
 * One wallet per User, period.  Same wallet whether the traveler
 * came in via Clerk corporate invite, WhatsApp lead, or B2C signup.
 * Same wallet across tenants when they switch employers.  Wallet =
 * permanent identity; tenant context lives at the policy +
 * TransferAttempt layer.
 *
 * Trigger: called from the booking-creation path the moment a
 * `Booking(status='pending')` row is written.  Concrete intent =
 * the traveler is going to need to settle this hold within hours.
 *
 * Idempotency: keyed on `(userId, provisioner='dcw')`.  Calling
 * twice for the same userId returns the same wallet on the second
 * call without hitting Circle.  The Circle SDK call uses a
 * deterministic UUID v5 idempotency key derived from the userId
 * so even concurrent invocations don't double-create.
 *
 * Failure mode: this helper is called inside the booking flow but
 * must NEVER block the hold.  Circle errors are caught, logged,
 * and surfaced as `null` so the caller proceeds.  We re-attempt on
 * the next booking for the same user, or at first pay attempt.
 */

import { createHash } from 'node:crypto';

import { getCircle } from '@sendero/circle';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { ensureUserIdentity } from './provision-identity';

const ARC_TESTNET_CHAIN_ID = 5042002;
/**
 * Circle DCW blockchain id for Arc Testnet.  The SDK accepts these as
 * the `Blockchain` enum strings; they don't match the chain id we
 * persist on `Wallet.chainId` (which is the EVM chain id integer).
 */
const ARC_BLOCKCHAIN = 'ARC-TESTNET' as const;

export interface EnsuredWallet {
  walletId: string;
  /** Sendero `Wallet.id` — primary key on the row. */
  rowId: string;
  /** Circle DCW id, e.g. `0190fe2c-…`. */
  circleWalletId: string;
  address: string;
  chainId: number;
  /** True when this call provisioned a new wallet, false on cache hit. */
  isNew: boolean;
}

/**
 * Idempotently provision the traveler's DCW EOA on Arc.
 *
 * Returns `null` when:
 *   - The platform walletset env isn't configured (booking still proceeds).
 *   - The Circle SDK throws (logged; booking still proceeds).
 *
 * Returns the persisted wallet otherwise.
 */
export async function ensureTravelerWallet(args: {
  userId: string;
}): Promise<EnsuredWallet | null> {
  // Cache check — single index hit on (userId, provisioner).
  const existing = await prisma.wallet.findFirst({
    where: { userId: args.userId, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
    select: { id: true, address: true, circleWalletId: true, chainId: true },
  });
  if (existing && existing.circleWalletId) {
    return {
      walletId: existing.id,
      rowId: existing.id,
      circleWalletId: existing.circleWalletId,
      address: existing.address,
      chainId: existing.chainId,
      isNew: false,
    };
  }

  const walletSetId = env.senderoWalletSetId();
  if (!walletSetId) {
    console.warn(
      `[ensureTravelerWallet] SENDERO_WALLETSET_ID not configured; skipping provisioning for user ${args.userId}`
    );
    return null;
  }

  let circle: ReturnType<typeof getCircle>;
  try {
    circle = getCircle();
  } catch (err) {
    console.warn(
      `[ensureTravelerWallet] Circle credentials missing; skipping provisioning for user ${args.userId}`,
      err instanceof Error ? err.message : err
    );
    return null;
  }

  // Deterministic idempotency key per (user, provisioner) so concurrent
  // booking calls don't race and double-create. Circle requires UUID v4
  // format, so we hash and reshape.
  const idempotencyKey = uuidv4FromSeed(`sendero:wallet:dcw:${args.userId}`);

  try {
    const response = await circle.createWallets({
      walletSetId,
      blockchains: [ARC_BLOCKCHAIN],
      accountType: 'EOA',
      count: 1,
      idempotencyKey,
    } as never);
    const wallet = (response.data as { wallets?: Array<{ id: string; address: string }> })
      ?.wallets?.[0];
    if (!wallet?.id || !wallet.address) {
      console.error('[ensureTravelerWallet] Circle response missing wallet shape', response.data);
      return null;
    }
    const row = await prisma.wallet.create({
      data: {
        userId: args.userId,
        provisioner: 'dcw',
        circleWalletId: wallet.id,
        circleWalletSetId: walletSetId,
        accountType: 'EOA',
        address: wallet.address,
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      select: { id: true, address: true, circleWalletId: true, chainId: true },
    });

    // Mint the traveler's ERC-8004 identity NFT atomically with wallet
    // provisioning. Failure is non-fatal — the wallet stands on its
    // own; the cron sweeper at /api/cron/retry-identity-provision
    // picks up pending rows. Reputation can accumulate against the
    // identity from day one once it lands.
    try {
      await ensureUserIdentity({ userId: args.userId });
    } catch (err) {
      console.warn(
        '[ensureTravelerWallet] user identity mint failed (non-fatal)',
        err instanceof Error ? err.message : err
      );
    }

    return {
      walletId: row.id,
      rowId: row.id,
      circleWalletId: row.circleWalletId ?? wallet.id,
      address: row.address,
      chainId: row.chainId,
      isNew: true,
    };
  } catch (err) {
    // Circle SDK can return existing wallet for duplicate idempotencyKey.
    // If our DB write raced with a concurrent caller and a row now
    // exists, return it instead of bubbling the error.
    const racedRow = await prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
      select: { id: true, address: true, circleWalletId: true, chainId: true },
    });
    if (racedRow && racedRow.circleWalletId) {
      return {
        walletId: racedRow.id,
        rowId: racedRow.id,
        circleWalletId: racedRow.circleWalletId,
        address: racedRow.address,
        chainId: racedRow.chainId,
        isNew: false,
      };
    }
    console.error(
      '[ensureTravelerWallet] provisioning failed',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Map an arbitrary string to a stable UUID v4-looking string.  Circle
 * expects UUID v4 format for idempotencyKey; deriving from a seed
 * means concurrent + retried calls land on the same wallet.
 *
 * Implementation: SHA-256 of the seed, take 16 bytes, set the version
 * + variant bits to make a valid v4-shaped uuid.
 */
function uuidv4FromSeed(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Variant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
