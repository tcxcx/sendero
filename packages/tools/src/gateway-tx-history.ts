/**
 * gateway_tx_history — unified traveler wallet transaction history.
 *
 * Closes the dogfood gap: user asked "muestrame las ultimas
 * transacciones desde mi gateway wallet?" — agent re-rendered the
 * balance card because no tx-history tool existed. They were also
 * audit-curious ("de donde pagaste el esim y el vuelo a mendoza??")
 * and the agent had no way to answer.
 *
 * Source-of-truth across three Sendero models:
 *   - TransferAttempt   on-chain spends + tenant pre-fund deposits
 *                       (kind='spend' | 'deposit', amountMicroUsdc,
 *                       destinationChain, txHash, status)
 *   - MoonPayTopUp      fiat → USDC ramps (status, baseCurrencyAmount,
 *                       cryptoTransactionHash)
 *   - MoonPayOffRamp    USDC → fiat ramps (mirror)
 *
 * Returns a chronological merged list with a normalized shape. Each
 * entry includes the on-chain tx hash when present so the traveler
 * can verify on Arcscan / Solana Explorer.
 *
 * Privacy + scope:
 *   - Tenant-bound via ctx.traveler.tenantId/userId. Never crosses
 *     tenants. Never aggregates other users' tx data.
 *   - Returns only what's needed — recipient address truncated to
 *     prefix...suffix, no internal Sendero ids leaked, only public
 *     on-chain hashes shared.
 *   - Read-only — never mutates state.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolDef, ToolContext } from './types';

const inputSchema = z.object({
  /** Max entries to return. Default 10, hard cap 50. */
  limit: z.number().int().min(1).max(50).default(10),
  /**
   * ISO 8601 lower bound. When set, only entries created after this
   * timestamp are returned. Default null (no lower bound).
   */
  sinceIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T.+)?$/)
    .optional(),
  /**
   * Filter by entry kind. Omit for all kinds. Useful when the user
   * asks specifically "what did I spend?" or "show me my top-ups".
   */
  kind: z.enum(['spend', 'deposit', 'topup', 'offramp']).optional(),
});

export type GatewayTxHistoryInput = z.infer<typeof inputSchema>;

export type TxKind = 'spend' | 'deposit' | 'topup' | 'offramp';
export type TxStatus = 'completed' | 'pending' | 'failed' | 'unknown';

export interface TxHistoryEntry {
  kind: TxKind;
  /** App Kit chain name ('Arc_Testnet', 'Base_Sepolia') or 'fiat'. */
  chain: string;
  /** Human-readable amount with currency suffix ('123.45 USDC' / '$25.00'). */
  amount: string;
  /** Truncated counterparty address or 'MoonPay'. */
  counterparty: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  status: TxStatus;
  /** On-chain tx hash (when available). */
  txHash: string | null;
  /** Booking PNR when this tx was a flight settlement. */
  bookingRef: string | null;
  /** Free-form note (App Kit fee breakdown, MoonPay reason, etc). */
  note: string | null;
}

export interface GatewayTxHistoryResult {
  status: 'ok' | 'no_traveler';
  entries: TxHistoryEntry[];
  message?: string;
}

const MICRO = 1_000_000n;

function formatUsdc(microUsdc: bigint): string {
  const whole = microUsdc / MICRO;
  const frac = microUsdc % MICRO;
  // Always 2-decimal display; pad fractional 6 → 2.
  const fracPadded = frac.toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${fracPadded} USDC`;
}

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function normalizeStatus(raw: string | null | undefined): TxStatus {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'completed' || s === 'passed' || s === 'executed' || s === 'confirmed')
    return 'completed';
  if (s === 'pending' || s === 'attesting' || s === 'minting') return 'pending';
  if (s === 'failed' || s === 'blocked' || s === 'abandoned') return 'failed';
  return 'unknown';
}

async function gatewayTxHistory(
  input: GatewayTxHistoryInput,
  ctx?: ToolContext
): Promise<GatewayTxHistoryResult> {
  const tenantId = ctx?.traveler?.tenantId;
  const userId = ctx?.traveler?.userId;
  if (!tenantId || !userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      entries: [],
      message:
        'No traveler resolved on this turn. Pass `travelerPhone` (E.164) on `call_sendero` so the history binds to a real Sendero User.',
    };
  }

  const limit = input.limit ?? 10;
  const sinceIso = input.sinceIso ? new Date(input.sinceIso) : undefined;
  const kindFilter = input.kind ?? null;

  // Pull each source in parallel. Each query already scopes to the
  // traveler so no cross-tenant leak.
  const [transferAttempts, topUps, offRamps] = await Promise.all([
    prisma.transferAttempt.findMany({
      where: {
        tenantId,
        travelerId: userId,
        ...(sinceIso ? { createdAt: { gte: sinceIso } } : {}),
        ...(kindFilter === 'spend' || kindFilter === 'deposit' ? { kind: kindFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // overfetch; merged list trims to `limit`
      select: {
        kind: true,
        amountMicroUsdc: true,
        recipient: true,
        destinationChain: true,
        status: true,
        txHash: true,
        metadata: true,
        createdAt: true,
      },
    }),
    kindFilter && kindFilter !== 'topup'
      ? Promise.resolve([])
      : prisma.moonPayTopUp.findMany({
          where: { userId, ...(sinceIso ? { createdAt: { gte: sinceIso } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit * 2,
          select: {
            id: true,
            baseCurrencyAmount: true,
            baseCurrencyCode: true,
            quoteCurrencyAmount: true,
            cryptoCurrencyCode: true,
            walletAddress: true,
            status: true,
            cryptoTransactionHash: true,
            failureReason: true,
            createdAt: true,
          },
        }),
    kindFilter && kindFilter !== 'offramp'
      ? Promise.resolve([])
      : prisma.moonPayOffRamp.findMany({
          where: { userId, ...(sinceIso ? { createdAt: { gte: sinceIso } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit * 2,
          select: {
            id: true,
            baseCurrencyAmount: true,
            baseCurrencyCode: true,
            quoteCurrencyAmount: true,
            quoteCurrencyCode: true,
            refundWalletAddress: true,
            status: true,
            cryptoTransactionHash: true,
            failureReason: true,
            createdAt: true,
          },
        }),
  ]);

  const entries: TxHistoryEntry[] = [];

  for (const ta of transferAttempts) {
    const meta = (ta.metadata ?? {}) as Record<string, unknown>;
    const bookingRef = typeof meta.pnr === 'string' ? meta.pnr : null;
    const feeNote =
      typeof meta.feeBreakdown === 'object' && meta.feeBreakdown
        ? `fee ${JSON.stringify(meta.feeBreakdown).slice(0, 60)}`
        : null;
    entries.push({
      kind: ta.kind === 'deposit' ? 'deposit' : 'spend',
      chain: ta.destinationChain,
      amount: formatUsdc(ta.amountMicroUsdc),
      counterparty: shortenAddress(ta.recipient),
      timestamp: ta.createdAt.toISOString(),
      status: normalizeStatus(ta.status),
      txHash: ta.txHash,
      bookingRef,
      note: feeNote,
    });
  }

  for (const t of topUps) {
    entries.push({
      kind: 'topup',
      chain: 'fiat',
      amount: `$${String(t.baseCurrencyAmount)} ${t.baseCurrencyCode.toUpperCase()}`,
      counterparty: 'MoonPay',
      timestamp: t.createdAt.toISOString(),
      status: normalizeStatus(t.status),
      txHash: t.cryptoTransactionHash,
      bookingRef: null,
      note:
        t.quoteCurrencyAmount != null
          ? `→ ${t.quoteCurrencyAmount} ${t.cryptoCurrencyCode.toUpperCase()}`
          : (t.failureReason ?? null),
    });
  }

  for (const o of offRamps) {
    entries.push({
      kind: 'offramp',
      chain: 'fiat',
      amount: `${String(o.baseCurrencyAmount)} ${o.baseCurrencyCode.toUpperCase()}`,
      counterparty: 'MoonPay',
      timestamp: o.createdAt.toISOString(),
      status: normalizeStatus(o.status),
      txHash: o.cryptoTransactionHash,
      bookingRef: null,
      note:
        o.quoteCurrencyAmount != null
          ? `→ ${o.quoteCurrencyCode.toUpperCase()} ${o.quoteCurrencyAmount}`
          : (o.failureReason ?? null),
    });
  }

  // Sort merged list desc by timestamp, trim to limit.
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  return {
    status: 'ok',
    entries: entries.slice(0, limit),
  };
}

export const gatewayTxHistoryTool: ToolDef<GatewayTxHistoryInput, GatewayTxHistoryResult> = {
  name: 'gateway_tx_history',
  description:
    "List the traveler's recent wallet activity — spends, deposits, MoonPay top-ups, and off-ramps — across every chain on a single chronological feed. Use when the user asks 'show me my recent transactions', 'where did the $X go?', 'how much have I spent this month?'. Each entry includes amount, counterparty, status, and the on-chain tx hash (when present) so the traveler can verify on the explorer. Tenant- and user-scoped via ctx.traveler — never crosses accounts. Read-only.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max entries to return. Default 10.',
      },
      sinceIso: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}(T.+)?$',
        description: 'ISO 8601 lower-bound timestamp (omit for no lower bound).',
      },
      kind: {
        type: 'string',
        enum: ['spend', 'deposit', 'topup', 'offramp'],
        description: 'Filter by entry kind. Omit for all.',
      },
    },
  },
  handler: gatewayTxHistory,
};
