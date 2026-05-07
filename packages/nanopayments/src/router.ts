/**
 * Per-chain router for the nanopayments adapters.
 *
 * Phase 6 — given a `chain`, dispatches to the Arc viem adapter or
 * the Solana web3.js adapter. Callers (NanopayBatch settler, booking
 * confirm path, x402 hot path) call this instead of the per-chain
 * helpers directly so the chain decision lives in one place.
 *
 * The `chain` arg should come from `tenant.primaryChain` (Phase 3
 * cascade) or, for cross-tenant settle paths (validator tip, Sendero
 * rail fee), from explicit configuration. Never inferred from
 * recipient address shape — that's brittle.
 */

import {
  transferUSDC as transferUSDCArc,
  settleCommissionSplit as settleCommissionSplitArc,
  type SplitLeg as ArcSplitLeg,
  type SplitResult as ArcSplitResult,
} from './index';
import {
  transferUSDCSolana,
  settleCommissionSplitSolana,
  type SolanaSplitLeg,
  type SolanaTransferResult,
  type SolanaSplitResult,
} from './solana';
import type { Address, Hex } from 'viem';

export type ChainKind = 'arc' | 'sol';

export interface UnifiedTransferResult {
  chain: ChainKind;
  /** Sig (Solana base58) or hash (Arc 0x-prefixed). */
  txHash: string;
  explorerUrl: string;
  amountMicroUsdc: string;
}

/**
 * Single-recipient transfer routed by chain. Arc accepts EVM
 * `0x...` addresses; Solana accepts base58 pubkeys. The router
 * doesn't validate shape — the underlying adapter throws on the
 * wrong format, which is the right place for that error to surface.
 */
export async function transferUSDCByChain(args: {
  chain: ChainKind;
  to: string;
  amount: string;
  label?: string;
}): Promise<UnifiedTransferResult> {
  if (args.chain === 'sol') {
    const result = await transferUSDCSolana({
      to: args.to,
      amount: args.amount,
      label: args.label,
    });
    return {
      chain: 'sol',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      amountMicroUsdc: result.amountMicroUsdc,
    };
  }
  const result = await transferUSDCArc({
    to: args.to as Address,
    amount: args.amount,
    label: args.label,
  });
  return {
    chain: 'arc',
    txHash: result.txHash,
    explorerUrl: result.explorerUrl,
    amountMicroUsdc: result.amountMicroUsdc,
  };
}

export interface UnifiedSplitLeg {
  /** Recipient — EVM address on Arc, base58 pubkey on Sol. */
  to: string;
  amount: string;
  label: string;
}

export interface UnifiedSplitResult {
  chain: ChainKind;
  txHash: string;
  explorerUrl: string;
  totalAmount: string;
  legs: Array<UnifiedSplitLeg & { amountMicroUsdc: string }>;
}

export async function settleCommissionSplitByChain(args: {
  chain: ChainKind;
  legs: UnifiedSplitLeg[];
}): Promise<UnifiedSplitResult> {
  if (args.chain === 'sol') {
    const result = await settleCommissionSplitSolana(
      args.legs.map(l => ({ to: l.to, amount: l.amount, label: l.label }))
    );
    return {
      chain: 'sol',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      totalAmount: result.totalAmount,
      legs: result.legs.map(l => ({
        to: l.to,
        amount: l.amount,
        label: l.label,
        amountMicroUsdc: l.amountMicroUsdc,
      })),
    };
  }
  const result = await settleCommissionSplitArc(
    args.legs.map(
      l => ({ to: l.to as Address, amount: l.amount, label: l.label }) as ArcSplitLeg
    )
  );
  return {
    chain: 'arc',
    txHash: result.txHash as Hex,
    explorerUrl: result.explorerUrl,
    totalAmount: result.totalAmount,
    legs: result.legs.map(l => ({
      to: l.to,
      amount: l.amount,
      label: l.label,
      amountMicroUsdc: l.amountUnits,
    })),
  };
}

export type { ArcSplitLeg, ArcSplitResult, SolanaSplitLeg, SolanaSplitResult, SolanaTransferResult };
