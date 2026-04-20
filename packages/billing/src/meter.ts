/**
 * Meter event recording primitives — the tip of the billing spear.
 *
 * Route handlers call `recordMetered(...)` once they know the action
 * succeeded. That does three things:
 *   1. Prices the action via `priceFor` (segment-aware).
 *   2. Runs the cap evaluator and returns blocked=true if the tenant
 *      hit a hard cap (caller MUST short-circuit and NOT call the
 *      underlying tool when blocked).
 *   3. Writes a MeterEvent row via the injected MeterStore.
 *
 * Actual on-chain settlement is batched asynchronously by
 * `@sendero/billing/batch`.
 */

import type { MeterStatus } from '@sendero/database';
import type { CapEvaluation, CapStore } from './caps';
import { evaluateCap } from './caps';
import { priceFor, gmvMicroCharge, type BillingSegment, type PricedAction } from './pricing';

export interface MeterEventInput {
  tenantId: string | null;
  userId?: string | null;
  payerAddress?: string | null;
  toolName: string;
  priceMicroUsdc: bigint;
  status: MeterStatus;
  settlementRef?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MeterStore {
  create: (input: MeterEventInput) => Promise<{ id: string }>;
}

export interface PreflightArgs {
  tenantId: string;
  action: PricedAction;
  segment: BillingSegment;
  /** Gross USDC amount for GMV take-rate actions. */
  grossMicroUsdc?: bigint;
  overrides?: Parameters<typeof priceFor>[0]['overrides'];
}

export interface PreflightResult {
  priceMicroUsdc: bigint;
  cap: CapEvaluation;
  /** Caller MUST NOT proceed if true. */
  blocked: boolean;
}

/**
 * Price + cap-check BEFORE running the tool. Use the returned
 * `priceMicroUsdc` to pass into `recordMetered` after success.
 */
export async function preflight(capStore: CapStore, args: PreflightArgs): Promise<PreflightResult> {
  const cell = priceFor({
    action: args.action,
    segment: args.segment,
    overrides: args.overrides,
  });
  const gmv = args.grossMicroUsdc
    ? gmvMicroCharge({ grossMicroUsdc: args.grossMicroUsdc, gmv: cell.gmv })
    : 0n;
  const price = cell.micro + gmv;

  const cap = await evaluateCap(capStore, {
    tenantId: args.tenantId,
    proposedMicroUsdc: price,
  });

  return { priceMicroUsdc: price, cap, blocked: cap.blocked };
}

export interface RecordArgs {
  meter: MeterStore;
  event: MeterEventInput;
}

export async function recordMetered(args: RecordArgs): Promise<{ id: string }> {
  return args.meter.create(args.event);
}
