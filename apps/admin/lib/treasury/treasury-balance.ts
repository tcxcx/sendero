/**
 * Live USDC balance read for treasury cards.
 *
 * NOT a server action — this is a plain server-only helper called
 * from the treasury page's Server Component. Adding `'use server'`
 * would force every export to be async (Next.js rejects type / const
 * re-exports under that directive).
 *
 * Arc: ERC-20 `balanceOf(multisigAddress)` on ARC_USDC_ADDRESS over the
 *      Arc-testnet RPC.
 * Sol: ATA owned by the vault PDA on devnet USDC mint.
 *
 * Fail-soft: any RPC blip or missing ATA returns `0n` with a status
 * flag so the card can render "0.00 USDC · uninitialized" instead of
 * crashing the page. This is an admin surface — we'd rather show a
 * stale-but-cheap zero than a thrown 500.
 *
 * Not cached. Each render hits chain — fine for an admin page; if it
 * becomes a hotspot wire `BalanceSync` (`packages/circle/src/balance-sync.ts`)
 * to back this with the same Circle webhook-driven row used for
 * tenant wallets.
 */

import { createPublicClient, http, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';

import type { SuperOrgTreasury } from '@sendero/database';

const ARC_USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000';
const ARC_RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

const SOL_DEVNET_RPC = 'https://api.devnet.solana.com';
const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const USDC_DECIMALS = 6;

const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface TreasuryBalance {
  /** Raw 6-decimal units. `0n` on any miss. */
  balanceMicro: bigint;
  /** Formatted with 2 decimals — what the card renders. */
  formatted: string;
  /** `live` = chain RPC returned a number, `uninitialized` = ATA missing
   *  (Solana only, no token account yet), `error` = read threw. */
  status: 'live' | 'uninitialized' | 'error';
  /** Short error message when `status === 'error'`. */
  error?: string;
}

const ZERO: TreasuryBalance = {
  balanceMicro: 0n,
  formatted: '0.00',
  status: 'live',
};

function format(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  // Two-decimal display — humans don't need micro-precision for "is
  // there money in the treasury?". The underlying value is preserved
  // in balanceMicro for any consumer that does.
  const fracTwo = (frac / 10_000n).toString().padStart(2, '0');
  return `${whole.toString()}.${fracTwo}`;
}

async function readArcUsdc(treasury: SuperOrgTreasury): Promise<TreasuryBalance> {
  try {
    const client = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
    const raw = (await client.readContract({
      address: ARC_USDC_ADDRESS,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [treasury.multisigAddress as Address],
    })) as bigint;
    return { balanceMicro: raw, formatted: format(raw), status: 'live' };
  } catch (err) {
    return {
      ...ZERO,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readSolanaUsdc(treasury: SuperOrgTreasury): Promise<TreasuryBalance> {
  try {
    const conn = new Connection(SOL_DEVNET_RPC, 'confirmed');
    const vault = new PublicKey(treasury.vaultAddress);
    const ata = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, vault, /* allowOwnerOffCurve */ true);
    try {
      const acct = await getAccount(conn, ata);
      const raw = BigInt(acct.amount.toString());
      return { balanceMicro: raw, formatted: format(raw), status: 'live' };
    } catch {
      // ATA not initialized — vault hasn't received USDC yet. The
      // first transfer auto-creates the ATA via the SPL Token program,
      // so this is the expected pre-funding state, not an error.
      return { ...ZERO, status: 'uninitialized' };
    }
  } catch (err) {
    return {
      ...ZERO,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getTreasuryUsdcBalance(
  treasury: SuperOrgTreasury
): Promise<TreasuryBalance> {
  if (treasury.chain === 'arc') return readArcUsdc(treasury);
  if (treasury.chain === 'sol') return readSolanaUsdc(treasury);
  return { ...ZERO, status: 'error', error: `Unknown chain "${treasury.chain}"` };
}

