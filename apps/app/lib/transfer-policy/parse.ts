/**
 * Pure row → PolicyGuard parser.
 *
 * Extracted from `load.ts` so unit tests can hit it without mocking
 * Prisma.  The loader composes a chain by mapping rows through this
 * function and dropping nulls.
 *
 * Validation lives here because a typo in a `config` JSON value should
 * never silently break agent dispatch.  Bad rows return `null` with a
 * `console.warn`; the loader skips them and the runtime continues with
 * a coherent (if narrower) chain.
 */

import {
  BudgetGuard,
  type BudgetStore,
  ConfirmGuard,
  type PolicyGuard,
  type PolicyScope,
  RateLimitGuard,
  type RateLimitStore,
  RecipientGuard,
  SingleTxGuard,
} from '@sendero/transfer-policy';

export interface PolicyRow {
  id: string;
  scope: string;
  guardKind: string;
  config: unknown;
  hardCap: boolean;
}

export interface BuildGuardDeps {
  budgetStore: BudgetStore;
  rateLimitStore: RateLimitStore;
  /** Override for tests; defaults to console.warn. */
  warn?: (row: PolicyRow, message: string) => void;
}

export function buildGuardFromRow(row: PolicyRow, deps: BuildGuardDeps): PolicyGuard | null {
  const warn = deps.warn ?? defaultWarn;
  const scope = parseScope(row.scope);
  if (!scope) {
    warn(row, `unknown scope "${row.scope}"`);
    return null;
  }
  const cfg = row.config as Record<string, unknown> | null;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    warn(row, 'config is not an object');
    return null;
  }
  switch (row.guardKind) {
    case 'budget': {
      const period = cfg.period;
      if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
        warn(row, 'budget.period must be daily|weekly|monthly');
        return null;
      }
      const cap = parseBigint(cfg.capMicroUsdc);
      if (cap === null) {
        warn(row, 'budget.capMicroUsdc must be a non-negative integer string');
        return null;
      }
      return new BudgetGuard({
        period,
        capMicroUsdc: cap,
        hardCap: row.hardCap,
        scope,
        store: deps.budgetStore,
      });
    }
    case 'single_tx': {
      const max = parseBigint(cfg.maxMicroUsdc);
      if (max === null) {
        warn(row, 'single_tx.maxMicroUsdc must be a non-negative integer string');
        return null;
      }
      return new SingleTxGuard({ maxMicroUsdc: max });
    }
    case 'recipient': {
      const mode = cfg.mode;
      const list = cfg.addresses;
      if (mode !== 'allow' && mode !== 'deny') {
        warn(row, 'recipient.mode must be allow|deny');
        return null;
      }
      if (!Array.isArray(list) || list.some(a => typeof a !== 'string')) {
        warn(row, 'recipient.addresses must be string[]');
        return null;
      }
      return new RecipientGuard({ mode, list: list as string[] });
    }
    case 'rate_limit': {
      const maxCount = cfg.maxCount;
      const windowMs = cfg.windowMs;
      if (typeof maxCount !== 'number' || maxCount < 1) {
        warn(row, 'rate_limit.maxCount must be ≥ 1');
        return null;
      }
      if (typeof windowMs !== 'number' || windowMs < 1) {
        warn(row, 'rate_limit.windowMs must be ≥ 1');
        return null;
      }
      return new RateLimitGuard({
        maxCount,
        windowMs,
        scope,
        store: deps.rateLimitStore,
      });
    }
    case 'confirm': {
      const trigger = cfg.triggerAtMicroUsdc;
      const reason = cfg.reason;
      const triggerBig =
        trigger === undefined || trigger === null ? undefined : parseBigint(trigger);
      if (triggerBig === null) {
        warn(row, 'confirm.triggerAtMicroUsdc must be a non-negative integer string when set');
        return null;
      }
      return new ConfirmGuard({
        triggerAtMicroUsdc: triggerBig,
        reason: typeof reason === 'string' ? reason : undefined,
      });
    }
    default:
      warn(row, `unknown guardKind "${row.guardKind}"`);
      return null;
  }
}

function parseScope(scope: string): PolicyScope | null {
  if (scope === 'tenant' || scope === 'traveler' || scope === 'tool') return scope;
  return null;
}

function parseBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function defaultWarn(row: PolicyRow, message: string): void {
  console.warn(`[transfer-policy] skipping row ${row.id} (${row.guardKind}): ${message}`);
}
