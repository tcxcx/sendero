/**
 * Single enforcement entry-point.
 *
 *   const verdict = await enforcePolicyChain(ctx);
 *   if (verdict.kind === 'blocked') return verdict.response;
 *   if (verdict.kind === 'pending') return verdict.response;
 *
 * Centralizes the load + run + envelope mapping so dispatch, the
 * future Unified Balance Kit transfer route, and any other call site
 * apply the same policy semantics with the same response shape.
 *
 * Hard rejection → HTTP 403 with `policy_blocked` body.
 * `requiresApproval` → HTTP 202 with `policy_pending_approval` body.
 * Pass → `{ kind: 'pass', trace }` so the caller can log evidence.
 */

import { NextResponse } from 'next/server';

import type { PaymentContext, PolicyChainResult } from '@sendero/transfer-policy';

import { loadPolicyChain, type LoadPolicyChainArgs } from './load';

export interface EnforceArgs extends LoadPolicyChainArgs {
  /** PaymentContext fields the chain inspects. */
  context: PaymentContext;
}

export type PolicyVerdict =
  | { kind: 'pass'; trace: PolicyChainResult['trace'] }
  | { kind: 'blocked'; response: NextResponse; trace: PolicyChainResult['trace'] }
  | { kind: 'pending'; response: NextResponse; trace: PolicyChainResult['trace'] };

export async function enforcePolicyChain({
  tenantId,
  travelerId,
  toolName,
  context,
}: EnforceArgs): Promise<PolicyVerdict> {
  const chain = await loadPolicyChain({ tenantId, travelerId, toolName });
  const result = await chain.check(context);
  if (!result.allowed) {
    return {
      kind: 'blocked',
      trace: result.trace,
      response: NextResponse.json(
        {
          error: 'policy_blocked',
          reason: result.reason,
          guard: result.guard,
          detail: result.detail,
          trace: result.trace.map(t => ({
            guard: t.guard,
            allowed: t.allowed,
            reason: t.reason,
            ...(t.detail ? { detail: t.detail } : {}),
          })),
        },
        { status: 403 }
      ),
    };
  }
  if (result.requiresApproval) {
    return {
      kind: 'pending',
      trace: result.trace,
      response: NextResponse.json(
        {
          error: 'policy_pending_approval',
          reason: result.reason,
          guard: result.guard,
          trace: result.trace.map(t => ({
            guard: t.guard,
            allowed: t.allowed,
            requiresApproval: t.requiresApproval ?? false,
            reason: t.reason,
          })),
        },
        { status: 202 }
      ),
    };
  }
  return { kind: 'pass', trace: result.trace };
}
