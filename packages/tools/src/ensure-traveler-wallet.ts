/**
 * `ensureTravelerWallet({ userId })` — lazy DCW provisioning.
 *
 * One wallet set per User, with one DCW EOA per supported chain.
 * Same wallet set whether the traveler came in via Clerk corporate
 * invite, WhatsApp lead, or B2C signup. Tenant context lives at the
 * policy + TransferAttempt layer.
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

import { getCircle, GATEWAY_CHAINS, type GatewayChainKey } from '@sendero/circle';
import { getOrCreateUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { ensureUserIdentity } from './provision-identity';
import { createHash } from 'node:crypto';

const ARC_TESTNET_CHAIN_ID = 5042002;
// Sendero stores numeric ids in Wallet.chainId. Solana does not have an
// EVM-style chain id, so we use Circle Gateway's Solana domain id.
const SOL_DEVNET_CHAIN_ID = 5;
/**
 * Circle DCW blockchain id for Arc Testnet.  The SDK accepts these as
 * the `Blockchain` enum strings; they don't match the chain id we
 * persist on `Wallet.chainId` (which is the EVM chain id integer).
 */
const ARC_BLOCKCHAIN = 'ARC-TESTNET' as const;
const SOL_BLOCKCHAIN = 'SOL-DEVNET' as const;

/**
 * Phase B.2 follow-up — register the traveler's DCW with Circle on
 * every Gateway-supported EVM chain so off-ramp flows that land on
 * Sepolia / Base / etc. trigger the auto-deposit webhook the same
 * way Arc inbounds do. Without this, MoonPay sandbox (which forces
 * Sepolia) drops USDC at the same `0x...` address but Circle's
 * webhook system never fires because no Wallet row was registered.
 *
 * We keep Arc as the canonical settlement chain (existing fast-path
 * stays — cache-hit reads on Arc bypass the loop entirely). After
 * the Arc DCW is provisioned the first time, the additional EVM
 * chains are registered in a fan-out (fail-soft per chain).
 */
function listEvmGatewayChains(): Array<{
  key: GatewayChainKey;
  circleId: string;
  chainId: number;
}> {
  const out: Array<{ key: GatewayChainKey; circleId: string; chainId: number }> = [];
  for (const [key, def] of Object.entries(GATEWAY_CHAINS) as Array<
    [GatewayChainKey, (typeof GATEWAY_CHAINS)[GatewayChainKey]]
  >) {
    if (def.kind !== 'evm') continue;
    const viemChain = (def as { viemChain?: { id: number } }).viemChain;
    if (!viemChain) continue;
    out.push({ key, circleId: def.circleId, chainId: viemChain.id });
  }
  return out;
}

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
  // Cache check — single index hit on (userId, provisioner, chainId).
  const existing = await prisma.wallet.findFirst({
    where: { userId: args.userId, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
    select: { id: true, address: true, circleWalletId: true, chainId: true },
  });
  if (existing?.circleWalletId) {
    await ensureTravelerSolanaWallet({ userId: args.userId }).catch(err => {
      console.warn(
        '[ensureTravelerWallet] Solana wallet provisioning failed (non-fatal)',
        err instanceof Error ? err.message : err
      );
    });
    // Backfill Gateway signer for users that pre-date T4. Idempotent.
    void ensureUserGatewaySigner({ userId: args.userId });
    // Phase B.2 follow-up — backfill cross-chain EVM Wallet rows for
    // users provisioned before this expansion. Idempotent (the helper
    // skips chains that already have a row) and fire-and-forget.
    void ensureTravelerEvmGatewayWallets({ userId: args.userId }).catch(err => {
      console.warn(
        '[ensureTravelerWallet] cross-chain EVM backfill failed (non-fatal)',
        err instanceof Error ? err.message : err
      );
    });
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

    await ensureTravelerSolanaWallet({ userId: args.userId, walletSetId, circle });

    // Phase B.2 follow-up — register the DCW with Circle on every
    // other Gateway EVM chain so off-ramp inbounds land on a tracked
    // wallet. Fire-and-forget; the Arc-only fast path above continues
    // to satisfy the canonical settlement requirement even if a
    // cross-chain registration races.
    void ensureTravelerEvmGatewayWallets({
      userId: args.userId,
      walletSetId,
      circle,
    }).catch(err => {
      console.warn(
        '[ensureTravelerWallet] cross-chain EVM Gateway provisioning failed (non-fatal)',
        err instanceof Error ? err.message : err
      );
    });

    // Provision the traveler's Gateway depositor EOA. Same pattern as
    // tenants — a self-custody viem EOA whose address is recorded as
    // the Circle Gateway depositor. The DCW above remains for native
    // Arc/Solana custody; this signer is what Gateway's /balances API
    // recognizes for the unified cross-chain USDC view.
    await ensureUserGatewaySigner({ userId: args.userId });

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
    if (racedRow?.circleWalletId) {
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
 * Provision (or backfill) DCW Wallet rows for every Gateway-supported
 * EVM chain other than Arc. Idempotent per chain — skips chains that
 * already have a row. Each Circle createWallets call uses a
 * deterministic idempotency key per (userId, chain) so concurrent
 * invocations land on the same wallet.
 *
 * Fail-soft per chain: a failure on one chain (Sepolia 5xx, Polygon
 * Amoy throttle) doesn't stop the others. Logs each outcome for ops.
 */
async function ensureTravelerEvmGatewayWallets(args: {
  userId: string;
  walletSetId?: string;
  circle?: ReturnType<typeof getCircle>;
}): Promise<void> {
  const walletSetId = args.walletSetId ?? env.senderoWalletSetId();
  if (!walletSetId) return;

  let circle = args.circle;
  if (!circle) {
    try {
      circle = getCircle();
    } catch {
      return;
    }
  }

  const chains = listEvmGatewayChains().filter(c => c.chainId !== ARC_TESTNET_CHAIN_ID);
  if (chains.length === 0) return;

  // Existing rows for this user → skip those chains.
  const existing = await prisma.wallet.findMany({
    where: { userId: args.userId, provisioner: 'dcw' },
    select: { chainId: true },
  });
  const existingChainIds = new Set(existing.map(w => w.chainId));

  for (const chain of chains) {
    if (existingChainIds.has(chain.chainId)) continue;
    try {
      const idempotencyKey = uuidv4FromSeed(`sendero:wallet:dcw:${args.userId}:${chain.circleId}`);
      const response = await circle.createWallets({
        walletSetId,
        blockchains: [chain.circleId],
        accountType: 'EOA',
        count: 1,
        idempotencyKey,
      } as never);
      const wallet = (response.data as { wallets?: Array<{ id: string; address: string }> })
        ?.wallets?.[0];
      if (!wallet?.id || !wallet.address) {
        console.warn('[ensureTravelerWallet] Circle response missing wallet shape', {
          userId: args.userId,
          circleId: chain.circleId,
        });
        continue;
      }
      await prisma.wallet.create({
        data: {
          userId: args.userId,
          provisioner: 'dcw',
          circleWalletId: wallet.id,
          circleWalletSetId: walletSetId,
          accountType: 'EOA',
          address: wallet.address,
          chainId: chain.chainId,
          metadata: { circleChain: chain.circleId, chainKey: chain.key },
        },
      });
      console.log('[ensureTravelerWallet] cross-chain DCW provisioned', {
        userId: args.userId,
        chainKey: chain.key,
        chainId: chain.chainId,
        address: wallet.address,
      });
    } catch (err) {
      console.warn('[ensureTravelerWallet] cross-chain provisioning failed (non-fatal)', {
        userId: args.userId,
        chainKey: chain.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function ensureTravelerSolanaWallet(args: {
  userId: string;
  walletSetId?: string;
  circle?: ReturnType<typeof getCircle>;
}): Promise<EnsuredWallet | null> {
  const existing = await prisma.wallet.findFirst({
    where: { userId: args.userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
    select: { id: true, address: true, circleWalletId: true, chainId: true },
  });
  if (existing?.circleWalletId) {
    return {
      walletId: existing.id,
      rowId: existing.id,
      circleWalletId: existing.circleWalletId,
      address: existing.address,
      chainId: existing.chainId,
      isNew: false,
    };
  }

  const walletSetId = args.walletSetId ?? env.senderoWalletSetId();
  if (!walletSetId) return null;

  let circle = args.circle;
  if (!circle) {
    try {
      circle = getCircle();
    } catch (err) {
      console.warn(
        `[ensureTravelerWallet] Circle credentials missing; skipping Solana provisioning for user ${args.userId}`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  try {
    const response = await circle.createWallets({
      walletSetId,
      blockchains: [SOL_BLOCKCHAIN],
      accountType: 'EOA',
      count: 1,
      idempotencyKey: uuidv4FromSeed(`sendero:wallet:dcw:${args.userId}:${SOL_BLOCKCHAIN}`),
    } as never);
    const wallet = (response.data as { wallets?: Array<{ id: string; address: string }> })
      ?.wallets?.[0];
    if (!wallet?.id || !wallet.address) {
      console.error(
        '[ensureTravelerWallet] Circle Solana response missing wallet shape',
        response.data
      );
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
        chainId: SOL_DEVNET_CHAIN_ID,
        metadata: { circleChain: SOL_BLOCKCHAIN, gatewayDomain: SOL_DEVNET_CHAIN_ID },
      },
      select: { id: true, address: true, circleWalletId: true, chainId: true },
    });
    return {
      walletId: row.id,
      rowId: row.id,
      circleWalletId: row.circleWalletId ?? wallet.id,
      address: row.address,
      chainId: row.chainId,
      isNew: true,
    };
  } catch (err) {
    const racedRow = await prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
      select: { id: true, address: true, circleWalletId: true, chainId: true },
    });
    if (racedRow?.circleWalletId) {
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
      '[ensureTravelerWallet] Solana provisioning failed',
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
/**
 * Provision the user's Gateway depositor EOA. Idempotent — re-runs are
 * cache hits in `getOrCreateUserGatewaySigner`. Failure is non-fatal:
 * the DCW still works for Arc/Solana, only the unified-balance view is
 * deferred until next call.
 */
async function ensureUserGatewaySigner(args: { userId: string }): Promise<void> {
  try {
    await getOrCreateUserGatewaySigner(args.userId, {
      caller: { surface: 'tool', userId: args.userId, context: 'ensure-traveler-wallet' },
    });
  } catch (err) {
    console.warn('[ensureTravelerWallet] user gateway signer provisioning failed (non-fatal)', {
      userId: args.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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
