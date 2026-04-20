/**
 * Per-tenant commission schedule.
 *
 * A schedule is a stack of legs, each claiming a basis-points share of
 * the gross. Remainder goes to the supplier (the "net" leg). Legs must
 * sum to less than 10_000 bps; the supplier leg is always last and
 * receives `10_000 - Σ(otherBps)`.
 *
 * Stored inline in the Tenant.metadata JSON for now (keeps Phase 2
 * small); migrate to a dedicated Prisma model once we need historical
 * versioning.
 */

export type CommissionLegKind = 'agency' | 'rail' | 'validator' | 'fee' | 'other';

export interface CommissionLeg {
  kind: CommissionLegKind;
  /** Basis points of gross. 10_000 = 100%. */
  bps: number;
  /** Destination address on Arc. */
  toAddress: string;
  /** Free-text label for audit. */
  note?: string;
}

export interface CommissionSchedule {
  /** Supplier always receives the residual (10_000 - Σ(otherBps)). */
  supplierAddress: string;
  legs: CommissionLeg[];
  /** Total bps must be less than 10_000 — validated on build. */
  version: string;
}

export const SENDERO_DEFAULTS = {
  // Product description: 0.5% take rate to Sendero rail.
  RAIL_BPS: 50,
  // Default validator tip to bootstrap ERC-8004 reputation participants.
  VALIDATOR_BPS: 30,
} as const;

export interface BuildScheduleArgs {
  supplierAddress: string;
  /** Agency commission — per-tenant, defaults 10% for agency-segment bookings. */
  agencyBps?: number;
  agencyAddress?: string;
  railAddress: string;
  railBps?: number;
  validatorAddress?: string;
  validatorBps?: number;
  version?: string;
}

export function buildSchedule(args: BuildScheduleArgs): CommissionSchedule {
  const legs: CommissionLeg[] = [];

  if (args.agencyBps && args.agencyBps > 0) {
    if (!args.agencyAddress) {
      throw new Error('agencyBps requires agencyAddress');
    }
    legs.push({
      kind: 'agency',
      bps: args.agencyBps,
      toAddress: args.agencyAddress,
      note: 'Agency commission',
    });
  }

  const railBps = args.railBps ?? SENDERO_DEFAULTS.RAIL_BPS;
  legs.push({
    kind: 'rail',
    bps: railBps,
    toAddress: args.railAddress,
    note: 'Sendero rail take-rate',
  });

  if (args.validatorAddress) {
    legs.push({
      kind: 'validator',
      bps: args.validatorBps ?? SENDERO_DEFAULTS.VALIDATOR_BPS,
      toAddress: args.validatorAddress,
      note: 'ERC-8004 validator tip',
    });
  }

  const total = legs.reduce((acc, l) => acc + l.bps, 0);
  if (total >= 10_000) {
    throw new Error(`Commission legs sum to ${total} bps — must be < 10_000`);
  }

  return {
    supplierAddress: args.supplierAddress,
    legs,
    version: args.version ?? '1',
  };
}
