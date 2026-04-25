/**
 * Prisma adapter for `@sendero/transfer-policy`.
 *
 * The package itself has zero runtime deps; this file is the thin
 * shim that connects the package's `BudgetStore` + `RateLimitStore`
 * interfaces to the Sendero schema (currently `MeterEvent`; will
 * extend to a `Transfer` table when DCW outbound spends ship).
 *
 * Both stores are tenant-scoped at the SQL layer.  When the guard
 * supplies `travelerId` or `toolName`, the where-clause narrows
 * further.
 */

import { prisma } from '@sendero/database';
import type { BudgetStore, RateLimitStore } from '@sendero/transfer-policy';

export const prismaBudgetStore: BudgetStore = {
  async spentInWindow({ tenantId, travelerId, toolName, windowStartedAt }) {
    const agg = await prisma.meterEvent.aggregate({
      where: {
        tenantId,
        ...(travelerId ? { userId: travelerId } : {}),
        ...(toolName ? { toolName } : {}),
        status: 'paid',
        at: { gte: windowStartedAt },
      },
      _sum: { priceMicroUsdc: true },
    });
    return agg._sum.priceMicroUsdc ?? 0n;
  },
};

export const prismaRateLimitStore: RateLimitStore = {
  async countInWindow({ tenantId, travelerId, toolName, windowStartedAt }) {
    return prisma.meterEvent.count({
      where: {
        tenantId,
        ...(travelerId ? { userId: travelerId } : {}),
        ...(toolName ? { toolName } : {}),
        status: 'paid',
        at: { gte: windowStartedAt },
      },
    });
  },
};
