/**
 * ensure_duffel_customer — keep a per-traveler Duffel CustomerUser in
 * sync and return the canonical `icu_…` id.
 *
 * Flow:
 *   1. Look up the User row by Clerk user id / email.
 *   2. If `user.duffelCustomerUserId` is already set → return it.
 *   3. Ensure the traveler's tenant has a CustomerUserGroup
 *      (`tenant.duffelCustomerUserGroupId`); create one on demand.
 *   4. Look up any existing Duffel CustomerUser by email (per-group
 *      uniqueness is enforced API-side) — reuse if present.
 *   5. Otherwise create a new CustomerUser with the group id.
 *   6. Persist both ids back to Prisma so subsequent calls are O(1).
 *
 * The tool is tenant-scoped and safe to call repeatedly (idempotent on
 * email + group). It's meant to be called by book_flight and any
 * other tool that needs a `icu_…` to pass into Duffel. Travelers get
 * Travel Support Assistant access the moment this returns.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import {
  createCustomerUser,
  createCustomerUserGroup,
  findCustomerUserByEmail,
} from '@sendero/duffel';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  /** Clerk userId of the traveler to ensure. If omitted, uses the caller. */
  clerkUserId: z.string().optional(),
  /** Tenant id (cuid) — overrides the caller's tenant when provided. */
  tenantId: z.string().optional(),
  /** Overrides used only when the User row is missing required fields. */
  email: z.string().email().optional(),
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  phoneNumber: z.string().optional(),
  preferredLanguage: z.string().optional(),
});

export type EnsureDuffelCustomerInput = z.infer<typeof inputSchema>;

export interface EnsureDuffelCustomerResult {
  userId: string;
  tenantId: string;
  duffelCustomerUserId: string;
  duffelCustomerUserGroupId: string;
  email: string;
  created: {
    customerUser: boolean;
    customerUserGroup: boolean;
  };
}

export async function ensureDuffelCustomer(
  input: EnsureDuffelCustomerInput,
  ctx?: ToolContext
): Promise<EnsureDuffelCustomerResult> {
  const clerkUserId = input.clerkUserId ?? ctx?.traveler?.userId;
  if (!clerkUserId) {
    throw new Error('ensure_duffel_customer: no clerkUserId supplied and no ctx.traveler.userId.');
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      duffelCustomerUserId: true,
      memberships: {
        where: input.tenantId ? { tenantId: input.tenantId } : undefined,
        take: 1,
        select: {
          tenantId: true,
          tenant: { select: { duffelCustomerUserGroupId: true, displayName: true } },
        },
      },
    },
  });
  if (!user) {
    throw new Error(`ensure_duffel_customer: no User row for clerkUserId=${clerkUserId}`);
  }

  const membership = user.memberships[0];
  if (!membership?.tenantId || !membership.tenant) {
    throw new Error(
      `ensure_duffel_customer: user ${user.id} has no membership in tenant ${input.tenantId ?? '(any)'}`
    );
  }

  const email = user.email || input.email;
  if (!email) {
    throw new Error(`ensure_duffel_customer: user ${user.id} has no email on record.`);
  }
  const display = (user.displayName ?? '').trim();
  const [autoGiven, ...autoFamilyParts] = display.split(/\s+/).filter(Boolean);
  const givenName = input.givenName ?? autoGiven ?? 'Traveler';
  const familyName = input.familyName ?? autoFamilyParts.join(' ') ?? 'Guest';
  const phone = input.phoneNumber ?? user.phone ?? undefined;

  // Ensure the tenant group exists.
  let groupId = membership.tenant.duffelCustomerUserGroupId;
  let groupCreated = false;
  if (!groupId) {
    const group = await createCustomerUserGroup({
      name: membership.tenant.displayName || `tenant-${membership.tenantId.slice(0, 8)}`,
      userIds: [],
    });
    groupId = group.id;
    groupCreated = true;
    await prisma.tenant.update({
      where: { id: membership.tenantId },
      data: { duffelCustomerUserGroupId: groupId },
    });
  }

  // Fast path: already linked.
  if (user.duffelCustomerUserId) {
    return {
      userId: user.id,
      tenantId: membership.tenantId,
      duffelCustomerUserId: user.duffelCustomerUserId,
      duffelCustomerUserGroupId: groupId,
      email,
      created: { customerUser: false, customerUserGroup: groupCreated },
    };
  }

  // Reuse an existing CustomerUser on this email if Duffel has one; else create.
  let customerUserId: string;
  let customerUserCreated = false;
  const existing = await findCustomerUserByEmail(email).catch(() => null);
  if (existing?.id) {
    customerUserId = existing.id;
  } else {
    const created = await createCustomerUser({
      email,
      given_name: givenName || 'Traveler',
      family_name: familyName || 'Guest',
      phone_number: phone,
      group_id: groupId,
      preferred_language: input.preferredLanguage,
    });
    customerUserId = created.id;
    customerUserCreated = true;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { duffelCustomerUserId: customerUserId },
  });

  return {
    userId: user.id,
    tenantId: membership.tenantId,
    duffelCustomerUserId: customerUserId,
    duffelCustomerUserGroupId: groupId,
    email,
    created: { customerUser: customerUserCreated, customerUserGroup: groupCreated },
  };
}

export const ensureDuffelCustomerTool: ToolDef<
  EnsureDuffelCustomerInput,
  EnsureDuffelCustomerResult
> = {
  name: 'ensure_duffel_customer',
  description:
    'Keep the traveler in sync with Duffel identity (CustomerUser + CustomerUserGroup). Idempotent: reuses an existing icu_… id on email match, creates one otherwise, and lazily ensures the tenant group. Call this before book_flight or any operation that should unlock Travel Support Assistant access for the end user.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      clerkUserId: { type: 'string', description: 'Traveler Clerk user id.' },
      tenantId: { type: 'string' },
      email: { type: 'string', format: 'email' },
      givenName: { type: 'string' },
      familyName: { type: 'string' },
      phoneNumber: { type: 'string', description: 'E.164 phone number.' },
      preferredLanguage: {
        type: 'string',
        description: 'BCP-47 language tag for Travel Support Assistant replies.',
      },
    },
  },
  handler: ensureDuffelCustomer,
};
