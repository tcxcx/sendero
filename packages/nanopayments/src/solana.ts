/**
 * Phase 6 — Solana counterpart of `transferUSDC` + `settleCommissionSplit`.
 *
 * Mirrors the Arc adapter's surface (`transferUSDC`, `settleCommissionSplit`)
 * so the per-chain router (`transferUSDCByChain` in the index barrel)
 * can dispatch transparently. Arc-side signs with `TREASURY_PRIVATE_KEY`
 * via viem; Solana-side signs with `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`
 * via @solana/web3.js + @solana/spl-token.
 *
 * # Why two adapters instead of a viem-Solana abstraction
 *
 * The signature shape is genuinely different — viem's `writeContract` +
 * Solana's `sendAndConfirmTransaction` don't share enough surface to
 * justify a unifying interface that wouldn't leak. The router on top
 * picks based on `chain` and dispatches to the right adapter; each
 * adapter stays idiomatic to its chain.
 *
 * # Conservation
 *
 * Both adapters return `{ txHash, explorerUrl, amountMicroUsdc }` so
 * upstream callers (NanopayBatch settler, Booking confirm path) treat
 * the result identically. The difference is `txHash` is a 64-byte
 * base58 sig on Solana and a 32-byte 0x-prefixed hash on Arc. The
 * `chain` field is added so consumers can filter explorer URLs.
 *
 * # Idempotency
 *
 * Same as Arc: caller is responsible. NanopayBatch.status='pending' →
 * one transfer in flight; on success → status='settled' with this
 * txHash recorded. Retries before settle don't double-spend because
 * the signer's nonce auto-increments and the destination ATA is
 * idempotent on creation.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';

const DEFAULT_RPC = 'https://api.devnet.solana.com';
/** Devnet USDC. Production override via `SENDERO_SOLANA_USDC_MINT`. */
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;

export interface SolanaTransferResult {
  chain: 'sol';
  /** Base58 signature. */
  txHash: string;
  /** Solana Explorer URL. Defaults to ?cluster=devnet. */
  explorerUrl: string;
  /** Amount in micro-USDC (6 decimals), as decimal string. */
  amountMicroUsdc: string;
}

function platformKeypair(): Keypair {
  const secret = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!secret) {
    throw new Error(
      '[@sendero/nanopayments] SENDERO_SOLANA_PLATFORM_PRIVATE_KEY required for Solana settle paths.'
    );
  }
  return Keypair.fromSecretKey(bs58.decode(secret));
}

function rpcUrl(): string {
  return process.env.SENDERO_SOLANA_RPC_URL ?? DEFAULT_RPC;
}

function usdcMint(): PublicKey {
  return new PublicKey(process.env.SENDERO_SOLANA_USDC_MINT ?? DEVNET_USDC);
}

function explorerUrl(sig: string): string {
  const cluster = rpcUrl().includes('devnet') ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${sig}${cluster}`;
}

/**
 * Convert a decimal-USDC string ("1.234567") to micro-USDC u64.
 *
 * Mirrors viem's `parseUnits(value, 6)` — strict on excess decimals.
 * Rejects negative values and anything > 6 decimal places.
 */
export function parseMicroUsdc(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`parseMicroUsdc: invalid amount "${amount}"`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > USDC_DECIMALS) {
    throw new Error(
      `parseMicroUsdc: too many decimals (${frac.length} > ${USDC_DECIMALS}) in "${amount}"`
    );
  }
  const padded = frac.padEnd(USDC_DECIMALS, '0');
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(padded);
}

/**
 * Single-recipient USDC SPL transfer on Solana. Counterpart of the
 * Arc-side `transferUSDC`. Uses `getOrCreateAssociatedTokenAccount`
 * for the recipient so first-time recipients work without a separate
 * ATA-creation tx.
 */
export async function transferUSDCSolana(params: {
  /** Recipient pubkey (base58). */
  to: string;
  /** Decimal USDC (6 decimals), e.g. "1.234567". */
  amount: string;
  /** Optional label for logging / telemetry. */
  label?: string;
}): Promise<SolanaTransferResult> {
  const units = parseMicroUsdc(params.amount);
  if (units <= 0n) {
    throw new Error(`transferUSDCSolana: amount must be > 0 (got ${params.amount})`);
  }

  const conn = new Connection(rpcUrl(), 'confirmed');
  const payer = platformKeypair();
  const mint = usdcMint();
  const recipient = new PublicKey(params.to);

  // Source ATA (platform wallet's USDC token account).
  const sourceAta = await getAssociatedTokenAddress(mint, payer.publicKey);

  // Recipient ATA — create on first use. Payer is the platform key
  // (same wallet that funds gas via the Solana gas station).
  const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    mint,
    recipient
  );

  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      recipientTokenAccount.address,
      payer.publicKey,
      units,
      USDC_DECIMALS
    )
  );

  const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: 'confirmed',
  });

  return {
    chain: 'sol',
    txHash: sig,
    explorerUrl: explorerUrl(sig),
    amountMicroUsdc: units.toString(),
  };
}

export interface SolanaSplitLeg {
  /** Recipient pubkey (base58). */
  to: string;
  /** Decimal USDC. */
  amount: string;
  /** Semantic tag — supplier / agency / rail / validator. */
  label: string;
}

export interface SolanaSplitResult {
  chain: 'sol';
  /** Sig of the FINAL leg (the "anchor" signature, mirrors Arc). */
  txHash: string;
  explorerUrl: string;
  totalAmount: string;
  legs: Array<SolanaSplitLeg & { amountMicroUsdc: string; signature: string }>;
}

/**
 * Solana counterpart of `settleCommissionSplit`. Sequential transfers
 * (one tx per leg) — Solana supports multi-instruction txs but mixing
 * 4 ATAs + 4 transfers in one tx hits compute / size limits unless
 * you batch carefully. Sequential keeps the simple model the Arc
 * adapter has and matches what NanopayBatch expects.
 */
export async function settleCommissionSplitSolana(
  legs: SolanaSplitLeg[]
): Promise<SolanaSplitResult> {
  if (!legs.length) throw new Error('settleCommissionSplitSolana: at least one leg required');

  let total = 0n;
  const out: SolanaSplitResult['legs'] = [];
  let lastSig = '';

  for (const leg of legs) {
    const result = await transferUSDCSolana({
      to: leg.to,
      amount: leg.amount,
      label: leg.label,
    });
    total += BigInt(result.amountMicroUsdc);
    lastSig = result.txHash;
    out.push({
      ...leg,
      amountMicroUsdc: result.amountMicroUsdc,
      signature: result.txHash,
    });
  }

  return {
    chain: 'sol',
    txHash: lastSig,
    explorerUrl: explorerUrl(lastSig),
    totalAmount: (Number(total) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS),
    legs: out,
  };
}
