/**
 * Core transfer-policy types.
 *
 * A `PolicyGuard` inspects a `PaymentContext` and returns a
 * `PolicyResult`. A `PolicyChain` runs a list of guards in order
 * and short-circuits on the first non-allowed result.  The result
 * distinguishes three outcomes:
 *
 *   1. allowed=true                          → proceed
 *   2. allowed=false                         → reject (hard block)
 *   3. allowed=true, requiresApproval=true   → pause for human approval
 *
 * Guards are async because real implementations may need to read
 * spend windows, recipient lists, or rate counters from a store.
 */

/** Where the payment is going. */
export type PaymentKind =
  | 'x402' // metered tool call (sub-cent agent purchase)
  | 'transfer' // direct USDC transfer to a recipient address
  | 'payout' // bulk payout / payroll
  | 'booking'; // operator-mediated booking settlement

/** Granularity of the policy's scope. */
export type PolicyScope = 'tenant' | 'traveler' | 'tool';

/** Everything a guard needs to evaluate a single payment. */
export interface PaymentContext {
  /** Always present. Tenant the action is charged to. */
  tenantId: string;
  /** Per-traveler scope when set. */
  travelerId?: string;
  /** Tool name when this is an x402 charge. */
  toolName?: string;
  /** Cents-per-thousand precision (i.e. micro-USDC). */
  amountMicroUsdc: bigint;
  /** Destination wallet for `transfer` / `payout`; null for x402. */
  recipient?: string | null;
  /** What kind of charge this is. */
  kind: PaymentKind;
  /** Wall-clock time the request landed at. Defaults to now() in chain. */
  at?: Date;
  /** When set, ConfirmGuard treats the payment as already approved. */
  preApproved?: boolean;
  /** Free-form metadata a caller can attach (e.g. agent DID, request id). */
  metadata?: Record<string, unknown>;
}

/** What a guard says about a payment. */
export interface PolicyResult {
  /** False = hard block. True with requiresApproval = soft pause. */
  allowed: boolean;
  /** Why the guard returned this result (for logs + UI). */
  reason?: string;
  /** Which guard fired. Filled in by the chain. */
  guard?: string;
  /**
   * When true, the chain reports `allowed: true` but with
   * `requiresApproval: true` so the caller pauses. Hard rejections
   * leave this undefined.
   */
  requiresApproval?: boolean;
  /** Optional structured detail (e.g. spent / cap remaining). */
  detail?: Record<string, unknown>;
}

/** Outcome of running a chain. */
export interface PolicyChainResult extends PolicyResult {
  /** All guard results in evaluation order, including the blocker. */
  trace: PolicyResult[];
}

/** Async predicate over a PaymentContext. */
export interface PolicyGuard {
  /** Stable id used in logs + traces. */
  readonly name: string;
  check(ctx: PaymentContext): Promise<PolicyResult>;
}

/**
 * Compose a list of policy guards.
 *
 * Evaluation order is the array order. The chain short-circuits on
 * the first hard rejection (`allowed: false`) but keeps walking past
 * `requiresApproval` so a transfer that needs approval AND violates
 * a subsequent budget guard still surfaces the budget block first
 * when the budget guard runs earlier.
 *
 * Behavior with multiple `requiresApproval`s: the chain returns
 * `allowed: true, requiresApproval: true` if ANY guard requested it
 * (and none hard-blocked).
 */
export class PolicyChain {
  constructor(public readonly guards: PolicyGuard[]) {}

  async check(ctx: PaymentContext): Promise<PolicyChainResult> {
    const trace: PolicyResult[] = [];
    let needsApproval = false;
    let approvalReason: string | undefined;
    const at = ctx.at ?? new Date();
    const filledCtx: PaymentContext = ctx.at ? ctx : { ...ctx, at };

    for (const guard of this.guards) {
      const raw = await guard.check(filledCtx);
      const result: PolicyResult = { ...raw, guard: raw.guard ?? guard.name };
      trace.push(result);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: result.reason,
          guard: result.guard,
          detail: result.detail,
          trace,
        };
      }
      if (result.requiresApproval) {
        needsApproval = true;
        if (!approvalReason) approvalReason = result.reason;
      }
    }
    return {
      allowed: true,
      requiresApproval: needsApproval || undefined,
      reason: approvalReason,
      guard: needsApproval ? trace.find(t => t.requiresApproval)?.guard : undefined,
      trace,
    };
  }
}
