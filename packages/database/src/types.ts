/**
 * Helper types re-exported from the generated Prisma client for
 * convenience in apps/app and apps/edge. Keeps call-sites short:
 *
 *   import type { TripWithBookings } from '@sendero/database/types';
 *
 * Prisma.validator preserves relation typing without hand-writing unions.
 */

import { Prisma } from '@prisma/client';

// ─── Tenant ────────────────────────────────────────────────────────────────

export const tenantWithPolicies = Prisma.validator<Prisma.TenantDefaultArgs>()({
  include: { policies: true },
});
export type TenantWithPolicies = Prisma.TenantGetPayload<typeof tenantWithPolicies>;

export const tenantWithMembers = Prisma.validator<Prisma.TenantDefaultArgs>()({
  include: { memberships: { include: { user: true } } },
});
export type TenantWithMembers = Prisma.TenantGetPayload<typeof tenantWithMembers>;

export const tenantFull = Prisma.validator<Prisma.TenantDefaultArgs>()({
  include: {
    policies: true,
    subscription: true,
    memberships: { include: { user: true } },
  },
});
export type TenantFull = Prisma.TenantGetPayload<typeof tenantFull>;

// ─── User ──────────────────────────────────────────────────────────────────

export const userWithWallets = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { wallets: true, memberships: { include: { tenant: true } } },
});
export type UserWithWallets = Prisma.UserGetPayload<typeof userWithWallets>;

// ─── Trip ──────────────────────────────────────────────────────────────────

export const tripWithBookings = Prisma.validator<Prisma.TripDefaultArgs>()({
  include: {
    bookings: { include: { supplier: true } },
    policy: true,
    traveler: true,
  },
});
export type TripWithBookings = Prisma.TripGetPayload<typeof tripWithBookings>;

export const tripFull = Prisma.validator<Prisma.TripDefaultArgs>()({
  include: {
    bookings: { include: { supplier: true, settlements: { include: { legs: true } } } },
    policy: true,
    traveler: true,
    createdBy: true,
    attestations: true,
    settlements: { include: { legs: true } },
  },
});
export type TripFull = Prisma.TripGetPayload<typeof tripFull>;

// ─── Booking ───────────────────────────────────────────────────────────────

export const bookingWithSettlement = Prisma.validator<Prisma.BookingDefaultArgs>()({
  include: { settlements: { include: { legs: true } }, supplier: true },
});
export type BookingWithSettlement = Prisma.BookingGetPayload<typeof bookingWithSettlement>;

// ─── Settlement ────────────────────────────────────────────────────────────

export const settlementWithLegs = Prisma.validator<Prisma.SettlementDefaultArgs>()({
  include: { legs: true },
});
export type SettlementWithLegs = Prisma.SettlementGetPayload<typeof settlementWithLegs>;

// ─── Policy rules (free-form JSON) ─────────────────────────────────────────

export interface PolicyRules {
  maxFlightUsd?: number;
  maxNightUsd?: number;
  intlCabinMinHours?: number;
  intlCabinRequired?: 'premium_economy' | 'business' | 'first';
  domesticCabin?: 'economy' | 'premium_economy';
  preferredCarriers?: string[];
  blacklistSuppliers?: string[];
  requireApproverOverUsd?: number;
  fiscalCountry?: 'MX' | 'BR' | 'AR' | 'US' | 'GB';
  [k: string]: unknown;
}

// ─── Trip event (agent-turn log entry) ─────────────────────────────────────

export interface TripEvent {
  at: string; // ISO
  kind:
    | 'user_msg'
    | 'assistant_msg'
    | 'tool_call'
    | 'tool_result'
    | 'policy_check'
    | 'booking'
    | 'settlement'
    | 'attestation'
    | 'approval'
    | 'error';
  toolName?: string;
  data?: unknown;
}
