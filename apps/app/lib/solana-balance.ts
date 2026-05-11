/**
 * Solana USDC balance reader — direct from RPC, bypassing the Circle
 * webhook cache.
 *
 * Treasury balance for Squads V4 vault PDAs can diverge from the
 * Circle-webhook-cached `CircleWallet.usdcBalanceMicro` because:
 *   - The vault PDA isn't a Circle-managed wallet in the usual sense;
 *     Circle's listWallets returns it but balance sync may skip it.
 *   - Funds can land via paths Circle doesn't observe (manual transfer,
 *     future booking-margin split, on-chain sweeper).
 *
 * This helper hits Solana RPC directly via
 * `getParsedTokenAccountsByOwner` and returns the canonical on-chain
 * USDC balance for any Solana owner address (vault PDA, DCW, etc.).
 *
 * Lifted from `apps/app/scripts/_local/diagnose-sol-deposit.ts` —
 * keep the two in sync if the parsed-info shape ever changes.
 *
 * Server-only — `@solana/web3.js` is heavy and shouldn't ship to the
 * client. Always call from a route handler or server action.
 */

import { Connection, PublicKey } from '@solana/web3.js';

export interface SolanaUsdcBalance {
  /** USDC in micro-units (6 decimals). 0n when no ATA exists yet. */
  usdcMicro: bigint;
  /** The ATA address that holds the balance, or null when missing. */
  ata: string | null;
  /** ISO timestamp when this reading was taken (now). */
  fetchedAt: string;
}

let cachedConn: Connection | null = null;

function getConnection(): Connection {
  if (cachedConn) return cachedConn;
  const rpc = process.env.SENDERO_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  cachedConn = new Connection(rpc, 'confirmed');
  return cachedConn;
}

function getUsdcMint(): PublicKey {
  const env = process.env.SENDERO_SOLANA_USDC_MINT;
  if (!env) {
    // Devnet default — matches the constant in the diagnose script.
    return new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  }
  return new PublicKey(env);
}

/**
 * Read USDC balance for a Solana owner directly from RPC. Returns 0n
 * when the owner has no USDC ATA (not minted yet). Throws on invalid
 * address or RPC failure — callers decide whether to fall back to
 * cached column.
 */
export async function readSolanaUsdcBalance(ownerBase58: string): Promise<SolanaUsdcBalance> {
  const conn = getConnection();
  const mint = getUsdcMint();
  const owner = new PublicKey(ownerBase58);

  const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  const fetchedAt = new Date().toISOString();
  if (accounts.value.length === 0) {
    return { usdcMicro: 0n, ata: null, fetchedAt };
  }

  // Sum across ATAs in case the owner has more than one (rare but
  // possible if a token-2022 mint or alt program created a duplicate).
  let total = 0n;
  let firstAta: string | null = null;
  for (const ta of accounts.value) {
    const info = ta.account.data.parsed.info as {
      tokenAmount?: { amount?: string };
    };
    const micro = info?.tokenAmount?.amount;
    if (!micro) continue;
    total += BigInt(micro);
    if (!firstAta) firstAta = ta.pubkey.toBase58();
  }

  return { usdcMicro: total, ata: firstAta, fetchedAt };
}
