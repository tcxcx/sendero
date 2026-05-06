/**
 * @sendero/tools/dev-gate — shared dev-only enforcement helper.
 *
 * Used by `report_knowledge_gap`, `recall_similar_turns` (PR2),
 * `find_resolved_gap` (PR3). Three independent gate conditions; ALL
 * must pass for the tool to actually execute. Fails closed (silent
 * `production_refused` return — never throws) so production agents
 * fall through to plan-from-scratch / `request_human_handoff` paths.
 *
 * Override: `SENDERO_GAPS_ALLOW_NONDEV=1` extends to ALL tools using
 * this gate. Reserved for the operator dashboard's manual surfaces;
 * never wire into the agent runtime.
 */

import type { ToolContext } from './types';

export type DevGateVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Three-condition gate:
 *   1. Env: `NODE_ENV !== 'production'` OR `VERCEL_ENV ∈ {undefined, 'development'}`.
 *      Production + preview deploys are dead-zone.
 *   2. Caller: `caller.effectiveKeyType !== 'production'`. Sandbox keys
 *      + operator console (no caller) allowed; production prod-keys
 *      refused regardless of env (capability-leak protection).
 *   3. Tenant: `ctx.traveler.tenantId` populated — refuse orphan rows.
 */
export function assertDevOnlyToolAllowed(ctx: ToolContext | undefined): DevGateVerdict {
  if (process.env.SENDERO_GAPS_ALLOW_NONDEV !== '1') {
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const vercelEnv = process.env.VERCEL_ENV;
    const isProdEnv =
      nodeEnv === 'production' && (vercelEnv === 'production' || vercelEnv === 'preview');
    if (isProdEnv) {
      return {
        allowed: false,
        reason:
          'This tool is dev-only. Set NODE_ENV=development OR run on local host. In production turns, escalate via request_human_handoff so an operator answers the traveler.',
      };
    }
  }

  // Production prod-keys refused regardless of env (capability-leak protection).
  if (ctx?.caller && ctx.caller.effectiveKeyType === 'production') {
    return {
      allowed: false,
      reason:
        'This tool is dev/sandbox only. Production prod-keys are refused regardless of environment to prevent capability-inventory leaks via leaked credentials.',
    };
  }

  // Tenant required to avoid orphan rows / cross-tenant data leak in recall.
  if (!ctx?.traveler?.tenantId) {
    return {
      allowed: false,
      reason: 'This tool requires tenant context — call from a turn with a resolved tenant.',
    };
  }

  return { allowed: true };
}
