/**
 * @sendero/transfer-policy — composable spending guards for AI agent
 * payments.  Pure-logic primitives so the same chain runs in the
 * agent dispatch path (x402 meter), in the operator-driven outbound
 * transfer flow, and in the future DCW traveler-policy enforcement
 * layer.
 *
 * Usage:
 *
 *   import {
 *     PolicyChain,
 *     BudgetGuard,
 *     SingleTxGuard,
 *     ConfirmGuard,
 *   } from '@sendero/transfer-policy';
 *
 *   const chain = new PolicyChain([
 *     new SingleTxGuard({ maxMicroUsdc: 5_000_000n }),
 *     new BudgetGuard({
 *       period: 'daily',
 *       capMicroUsdc: 50_000_000n,
 *       hardCap: true,
 *       scope: 'tenant',
 *       store: budgetStore,
 *     }),
 *     new ConfirmGuard({ triggerAtMicroUsdc: 1_000_000_000n }),
 *   ]);
 *
 *   const result = await chain.check({
 *     tenantId: 'tnt_…',
 *     amountMicroUsdc: 250_000n,
 *     kind: 'x402',
 *     toolName: 'duffel.search',
 *   });
 *
 *   if (!result.allowed) {
 *     // Hard rejection — block the call, surface result.reason.
 *   } else if (result.requiresApproval) {
 *     // Pause for operator approval, replay the chain with
 *     // preApproved=true after they click.
 *   } else {
 *     // Proceed.
 *   }
 *
 * The package has zero runtime dependencies.  Concrete data sources
 * (Prisma, Redis, etc.) live behind the small Store interfaces each
 * guard exposes — the consuming app supplies them.
 */

export type {
  PaymentContext,
  PaymentKind,
  PolicyChainResult,
  PolicyGuard,
  PolicyResult,
  PolicyScope,
} from './types';
export { PolicyChain } from './types';

export {
  BudgetGuard,
  type BudgetGuardOptions,
  type BudgetPeriod,
  type BudgetStore,
  defaultStartOfWindow,
  ConfirmGuard,
  type ConfirmGuardOptions,
  RateLimitGuard,
  type RateLimitGuardOptions,
  type RateLimitStore,
  RecipientGuard,
  type RecipientGuardOptions,
  SingleTxGuard,
  type SingleTxGuardOptions,
} from './guards';
