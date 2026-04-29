/**
 * Helper types re-exported from the generated Prisma client for
 * convenience in apps/app and apps/edge. Keeps call-sites short:
 *
 *   import type { TripWithBookings } from '@sendero/database/types';
 */

import { Prisma } from '@prisma/client';

// ─── Tenant ────────────────────────────────────────────────────────────────

export const tenantWithPolicies = {
  include: { policies: true },
} satisfies Prisma.TenantDefaultArgs;
export type TenantWithPolicies = Prisma.TenantGetPayload<typeof tenantWithPolicies>;

export const tenantWithMembers = {
  include: { memberships: { include: { user: true } } },
} satisfies Prisma.TenantDefaultArgs;
export type TenantWithMembers = Prisma.TenantGetPayload<typeof tenantWithMembers>;

export const tenantFull = {
  include: {
    policies: true,
    subscription: true,
    memberships: { include: { user: true } },
  },
} satisfies Prisma.TenantDefaultArgs;
export type TenantFull = Prisma.TenantGetPayload<typeof tenantFull>;

// ─── User ──────────────────────────────────────────────────────────────────

export const userWithWallets = {
  include: { wallets: true, memberships: { include: { tenant: true } } },
} satisfies Prisma.UserDefaultArgs;
export type UserWithWallets = Prisma.UserGetPayload<typeof userWithWallets>;

// ─── Trip ──────────────────────────────────────────────────────────────────

export const tripWithBookings = {
  include: {
    bookings: { include: { supplier: true } },
    policy: true,
    traveler: true,
  },
} satisfies Prisma.TripDefaultArgs;
export type TripWithBookings = Prisma.TripGetPayload<typeof tripWithBookings>;

export const tripFull = {
  include: {
    bookings: { include: { supplier: true, settlements: { include: { legs: true } } } },
    policy: true,
    traveler: true,
    createdBy: true,
    attestations: true,
    settlements: { include: { legs: true } },
  },
} satisfies Prisma.TripDefaultArgs;
export type TripFull = Prisma.TripGetPayload<typeof tripFull>;

// ─── Booking ───────────────────────────────────────────────────────────────

export const bookingWithSettlement = {
  include: { settlements: { include: { legs: true } }, supplier: true },
} satisfies Prisma.BookingDefaultArgs;
export type BookingWithSettlement = Prisma.BookingGetPayload<typeof bookingWithSettlement>;

// ─── Settlement ────────────────────────────────────────────────────────────

export const settlementWithLegs = {
  include: { legs: true },
} satisfies Prisma.SettlementDefaultArgs;
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
