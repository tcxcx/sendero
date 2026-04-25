/**
 * Prisma adapter for `@sendero/transfer-policy`.
 *
 * The package itself has zero runtime deps; this file is the thin
 * shim that connects the package's `BudgetStore` + `RateLimitStore`
 * interfaces to the Sendero schema.
 *
 * Two sources of "spend" feed the same window math:
 *   - `MeterEvent`  → x402 metered tool calls (status='paid').
 *   - `TransferAttempt` → DCW / Unified Balance outbound spends
 *                          (status='executed').
 *
 * Both are tenant-scoped at the SQL layer.  When the guard supplies
 * `travelerId` or `toolName`, the where-clauses narrow further.
 * `toolName` only applies to MeterEvent (TransferAttempt has no tool
 * dimension).
 */

import { prisma } from '@sendero/database';
import type { BudgetStore, RateLimitStore } from '@sendero/transfer-policy';

export const prismaBudgetStore: BudgetStore = {
  async spentInWindow({ tenantId, travelerId, toolName, windowStartedAt }) {
    const [meter, transfer] = await Promise.all([
      prisma.meterEvent.aggregate({
        where: {
          tenantId,
          ...(travelerId ? { userId: travelerId } : {}),
          ...(toolName ? { toolName } : {}),
          status: 'paid',
          at: { gte: windowStartedAt },
        },
        _sum: { priceMicroUsdc: true },
      }),
      // TransferAttempt has no tool dimension. When the guard scope
      // is `tool`, transfers don't apply (returning 0 keeps the budget
      // logic correct for both scopes).
      toolName
        ? Promise.resolve({ _sum: { amountMicroUsdc: 0n } })
        : prisma.transferAttempt.aggregate({
            where: {
              tenantId,
              ...(travelerId ? { travelerId } : {}),
              status: 'executed',
              createdAt: { gte: windowStartedAt },
            },
            _sum: { amountMicroUsdc: true },
          }),
    ]);
    const meterSum = meter._sum.priceMicroUsdc ?? 0n;
    const transferSum = transfer._sum.amountMicroUsdc ?? 0n;
    return meterSum + transferSum;
  },
};

export const prismaRateLimitStore: RateLimitStore = {
  async countInWindow({ tenantId, travelerId, toolName, windowStartedAt }) {
    const [meterCount, transferCount] = await Promise.all([
      prisma.meterEvent.count({
        where: {
          tenantId,
          ...(travelerId ? { userId: travelerId } : {}),
          ...(toolName ? { toolName } : {}),
          status: 'paid',
          at: { gte: windowStartedAt },
        },
      }),
      toolName
        ? Promise.resolve(0)
        : prisma.transferAttempt.count({
            where: {
              tenantId,
              ...(travelerId ? { travelerId } : {}),
              status: 'executed',
              createdAt: { gte: windowStartedAt },
            },
          }),
    ]);
    return meterCount + transferCount;
  },
};
