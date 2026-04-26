/**
 * Load and compose a `PolicyChain` for a given scope tuple.
 *
 *   loadPolicyChain({ tenantId })
 *     → tenant-scoped guards only.
 *
 *   loadPolicyChain({ tenantId, travelerId })
 *     → tenant-scoped + traveler-scoped guards.
 *
 *   loadPolicyChain({ tenantId, toolName })
 *     → tenant-scoped + tool-scoped guards.
 *
 * Rows with malformed `config` JSON are skipped via the parser's
 * warn callback — a typo in the editor never silently breaks agent
 * dispatch.  The runtime always has a coherent chain, even if it's
 * empty.
 */

import { prisma } from '@sendero/database';
import { PolicyChain, type PolicyGuard } from '@sendero/transfer-policy';

import { buildGuardFromRow } from './parse';
import { prismaBudgetStore, prismaRateLimitStore } from './store';

export interface LoadPolicyChainArgs {
  tenantId: string;
  travelerId?: string;
  toolName?: string;
}

export async function loadPolicyChain(args: LoadPolicyChainArgs): Promise<PolicyChain> {
  const orFilters: Array<Record<string, unknown>> = [
    { scope: 'tenant', travelerId: null, toolName: null },
  ];
  if (args.travelerId) {
    orFilters.push({ scope: 'traveler', travelerId: args.travelerId });
  }
  if (args.toolName) {
    orFilters.push({ scope: 'tool', toolName: args.toolName });
  }
  const rows = await prisma.transferPolicy.findMany({
    where: {
      tenantId: args.tenantId,
      enabled: true,
      OR: orFilters,
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const guards: PolicyGuard[] = [];
  for (const row of rows) {
    const guard = buildGuardFromRow(row, {
      budgetStore: prismaBudgetStore,
      rateLimitStore: prismaRateLimitStore,
    });
    if (guard) guards.push(guard);
  }
  return new PolicyChain(guards);
}
