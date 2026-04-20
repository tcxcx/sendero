/**
 * In-memory meter for per-tool nanopayment events.
 *
 * Emits a MeterEvent for every paid tool call. Subscribers stream to
 * the live usage feed (SSE endpoint) or the margin panel. Append-only
 * ring buffer capped at MAX_EVENTS to prevent unbounded growth in a
 * long-running demo.
 *
 * For a real deployment this would back onto Redis or a SQL table —
 * this is the hackathon-grade version.
 */

import { ETHEREUM_MAINNET_PER_CALL_USD } from './pricing';

export interface MeterEvent {
  /** ms epoch. */
  at: number;
  /** Tool invoked. */
  toolName: string;
  /** USDC price charged, decimal string (e.g. "0.005"). */
  priceUsdc: string;
  /** Caller wallet address (payer). */
  payer?: string;
  /** Settlement reference — Gateway transfer ID or onchain tx hash. */
  settlementRef?: string;
  /** 'paid' when x402 settled, 'free' for unmetered calls, 'rejected' for 402. */
  status: 'paid' | 'free' | 'rejected';
  /** Optional human-readable note for the feed. */
  note?: string;
}

const MAX_EVENTS = 10_000;
const _events: MeterEvent[] = [];
const _listeners = new Set<(e: MeterEvent) => void>();

export function logMeter(event: MeterEvent): void {
  _events.push(event);
  if (_events.length > MAX_EVENTS) {
    _events.splice(0, _events.length - MAX_EVENTS);
  }
  for (const l of _listeners) {
    try {
      l(event);
    } catch {
      /* listener errors don't break other listeners */
    }
  }
}

export function getMeterEvents(since?: number): MeterEvent[] {
  if (since === undefined) return _events.slice();
  return _events.filter((e) => e.at >= since);
}

export function subscribeMeter(
  listener: (e: MeterEvent) => void,
): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export interface MeterSummary {
  /** Total USDC collected across paid calls. */
  totalUsdc: string;
  /** Total number of events (all statuses). */
  totalEvents: number;
  /** Paid calls. */
  paidCalls: number;
  /** Rejected (unpaid or invalid) calls. */
  rejectedCalls: number;
  /** Free calls (e.g., meta endpoints). */
  freeCalls: number;
  /** Per-tool breakdown. */
  byTool: Record<string, { count: number; usdc: string }>;
  /** Margin panel numbers — what this workload would cost on Ethereum. */
  ethereum: {
    /** Per-call baseline. */
    perCallUsd: number;
    /** Total estimated Ethereum mainnet cost for the same calls. */
    totalUsd: number;
    /** The cost delta factor (Ethereum / Arc). */
    marginFactor: number;
  };
}

export function meterSummary(): MeterSummary {
  let totalMicro = 0n;
  const byTool: Record<string, { count: number; micro: bigint }> = {};
  let paidCalls = 0;
  let rejectedCalls = 0;
  let freeCalls = 0;

  for (const e of _events) {
    if (e.status === 'paid') {
      paidCalls++;
      const [whole, frac = ''] = e.priceUsdc.split('.');
      const atomic = BigInt(
        (whole || '0') + (frac + '000000').slice(0, 6),
      );
      totalMicro += atomic;
      const bucket = byTool[e.toolName] || { count: 0, micro: 0n };
      bucket.count++;
      bucket.micro += atomic;
      byTool[e.toolName] = bucket;
    } else if (e.status === 'rejected') {
      rejectedCalls++;
    } else {
      freeCalls++;
    }
  }

  const totalUsdc = (Number(totalMicro) / 1e6).toFixed(6);
  const totalCount = paidCalls + rejectedCalls + freeCalls;
  const ethereumTotal = totalCount * ETHEREUM_MAINNET_PER_CALL_USD;
  const marginFactor = totalMicro > 0n
    ? (ethereumTotal * 1e6) / Number(totalMicro)
    : 0;

  return {
    totalUsdc,
    totalEvents: totalCount,
    paidCalls,
    rejectedCalls,
    freeCalls,
    byTool: Object.fromEntries(
      Object.entries(byTool).map(([k, v]) => [
        k,
        { count: v.count, usdc: (Number(v.micro) / 1e6).toFixed(6) },
      ]),
    ),
    ethereum: {
      perCallUsd: ETHEREUM_MAINNET_PER_CALL_USD,
      totalUsd: Number(ethereumTotal.toFixed(2)),
      marginFactor: Math.round(marginFactor),
    },
  };
}

/** Dev/test-only — wipes the meter. */
export function __resetMeter(): void {
  _events.length = 0;
}
