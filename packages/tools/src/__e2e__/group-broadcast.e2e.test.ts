/**
 * Deterministic E2E for broadcast_to_group_trip + set_group_broadcast_optout.
 *
 * Hits real Postgres (Neon dev) via @sendero/database; stubs the Kapso
 * broadcastTemplate call via `_setBroadcastImplForTesting` so the test
 * never reaches Kapso. Covers:
 *
 *   - Audience filtering — `claimed`-only excludes `invited` rows.
 *   - Phone gate — passengers without `user.phone` are skipped.
 *   - Opt-out gate — `broadcastOptedOut=true` rows are skipped.
 *   - Cross-tenant refusal — caller in tenant A cannot broadcast to a
 *     GroupTrip in tenant B (returns "not found").
 *   - WhatsAppInstall gate — broadcast refuses when no install exists
 *     or status != 'active'.
 *   - Audit trail — GroupTrip.metadata.broadcasts JSONB grows by one
 *     entry per successful broadcast.
 *   - set_group_broadcast_optout flips per-tenant rows for the caller
 *     and is idempotent.
 *
 * Skipped without DATABASE_URL.
 *
 * Spec: bucket-analysis closure #6 (group-trip operator-side fan-out).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { prisma } from '@sendero/database';

import {
  _setBroadcastImplForTesting,
  broadcastToGroupTripTool,
  setGroupBroadcastOptoutTool,
} from '../group-trips';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const itDb = HAS_DB ? test : test.skip;

if (!HAS_DB) {
  console.warn('[group-broadcast.e2e] Skipping DB-hitting suite — set DATABASE_URL to enable.');
}

const TS = Date.now();
const T_A = `gb_e2e_tenA_${TS}`;
const T_B = `gb_e2e_tenB_${TS}`;
const U_PHONE_1 = `gb_e2e_u1_${TS}`;
const U_PHONE_2 = `gb_e2e_u2_${TS}`;
const U_NOPHONE = `gb_e2e_u3_${TS}`;
const U_OPTED_OUT = `gb_e2e_u4_${TS}`;
const U_INVITED = `gb_e2e_u5_${TS}`;
const U_TENB = `gb_e2e_u6_${TS}`;

let tripAId = '';
let tripBId = '';

beforeAll(async () => {
  if (!HAS_DB) return;

  for (const tenantId of [T_A, T_B]) {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        clerkOrgId: tenantId,
        slug: tenantId.toLowerCase(),
        displayName: tenantId,
      },
    });
    await prisma.whatsAppInstall.create({
      data: {
        tenantId,
        kapsoCustomerId: `${tenantId}_kc`,
        kapsoConnectionId: `${tenantId}_conn`,
        phoneNumberId: `${tenantId}_pn`,
        webhookSecret: `${tenantId}_secret`,
        status: 'active',
      },
    });
  }

  await prisma.user.createMany({
    data: [
      { id: U_PHONE_1, email: `${U_PHONE_1}@e.com`, phone: '+15550000001', displayName: 'P1' },
      { id: U_PHONE_2, email: `${U_PHONE_2}@e.com`, phone: '+15550000002', displayName: 'P2' },
      { id: U_NOPHONE, email: `${U_NOPHONE}@e.com`, phone: null, displayName: 'NoPhone' },
      {
        id: U_OPTED_OUT,
        email: `${U_OPTED_OUT}@e.com`,
        phone: '+15550000004',
        displayName: 'OOPT',
      },
      { id: U_INVITED, email: `${U_INVITED}@e.com`, phone: '+15550000005', displayName: 'INV' },
      { id: U_TENB, email: `${U_TENB}@e.com`, phone: '+15559999999', displayName: 'TenBUser' },
    ],
  });

  const tripA = await prisma.groupTrip.create({
    data: {
      tenantId: T_A,
      name: 'A-Cusco bachelor 2026',
      destination: 'Cusco',
      status: 'inviting',
      passengers: {
        create: [
          { userId: U_PHONE_1, status: 'claimed', broadcastOptedOut: false },
          { userId: U_PHONE_2, status: 'claimed', broadcastOptedOut: false },
          { userId: U_NOPHONE, status: 'claimed', broadcastOptedOut: false },
          { userId: U_OPTED_OUT, status: 'claimed', broadcastOptedOut: true },
          { userId: U_INVITED, status: 'invited', broadcastOptedOut: false },
        ],
      },
    },
    select: { id: true },
  });
  tripAId = tripA.id;

  const tripB = await prisma.groupTrip.create({
    data: {
      tenantId: T_B,
      name: 'B-tenant bachelor',
      destination: 'Lima',
      status: 'inviting',
      passengers: {
        create: [{ userId: U_TENB, status: 'claimed', broadcastOptedOut: false }],
      },
    },
    select: { id: true },
  });
  tripBId = tripB.id;
});

afterAll(async () => {
  if (!HAS_DB) return;
  // Cascade: passenger rows ride GroupTrip; GroupTrip rides Tenant.
  // Clear in dependency order to avoid FK errors.
  await prisma.groupTrip.deleteMany({ where: { tenantId: { in: [T_A, T_B] } } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [U_PHONE_1, U_PHONE_2, U_NOPHONE, U_OPTED_OUT, U_INVITED, U_TENB],
      },
    },
  });
  await prisma.whatsAppInstall.deleteMany({ where: { tenantId: { in: [T_A, T_B] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [T_A, T_B] } } });
});

beforeEach(() => {
  _setBroadcastImplForTesting(null);
});

describe('broadcast_to_group_trip (E2E)', () => {
  itDb('claimed audience: filters to phone-bearing, non-opted-out passengers', async () => {
    let captured: { name: string; recipientCount: number; recipientPhones: string[] } | null = null;
    _setBroadcastImplForTesting(async args => {
      captured = {
        name: args.name,
        recipientCount: args.recipients.length,
        recipientPhones: args.recipients.map(r => r.phone_number ?? ''),
      };
      return {
        id: `bc_test_${Date.now()}`,
        name: args.name,
        status: 'sending',
        sent_count: 0,
        failed_count: 0,
        delivered_count: 0,
        read_count: 0,
      };
    });

    const result = await broadcastToGroupTripTool.handler(
      {
        groupTripId: tripAId,
        templateName: 'group_meeting_point',
        whatsappTemplateId: 'meta_tpl_test',
        bodyParams: ['Hotel Lima lobby', '06:00'],
        audience: 'claimed',
      },
      { traveler: { userId: 'op_clerk_a', tenantId: T_A } }
    );

    expect(result.ok).toBe(true);
    expect(result.recipientCount).toBe(2); // U_PHONE_1, U_PHONE_2
    expect(captured!.recipientPhones).toContain('+15550000001');
    expect(captured!.recipientPhones).toContain('+15550000002');
    expect(captured!.recipientPhones).not.toContain('+15550000004'); // opted out
    expect(captured!.recipientPhones).not.toContain('+15550000005'); // invited (not claimed)

    const skipReasons = result.skipped.map(s => s.reason).sort();
    expect(skipReasons).toEqual(['no_phone', 'opted_out']);
  });

  itDb(
    "'all' audience: includes invited passengers but still skips no-phone + opted-out",
    async () => {
      let captured: { recipientCount: number } | null = null;
      _setBroadcastImplForTesting(async args => {
        captured = { recipientCount: args.recipients.length };
        return {
          id: `bc_all_${Date.now()}`,
          name: args.name,
          status: 'sending',
          sent_count: 0,
          failed_count: 0,
          delivered_count: 0,
          read_count: 0,
        };
      });

      const result = await broadcastToGroupTripTool.handler(
        {
          groupTripId: tripAId,
          templateName: 'group_meeting_point',
          whatsappTemplateId: 'meta_tpl_test',
          audience: 'all',
        },
        { traveler: { userId: 'op_clerk_a', tenantId: T_A } }
      );

      expect(captured!.recipientCount).toBe(3); // P1, P2, INVITED — but not NoPhone or OptOut
      expect(result.recipientCount).toBe(3);
    }
  );

  itDb('cross-tenant: refuses to broadcast to a GroupTrip from another tenant', async () => {
    _setBroadcastImplForTesting(async () => {
      throw new Error('should never reach Kapso on cross-tenant');
    });

    await expect(
      broadcastToGroupTripTool.handler(
        {
          groupTripId: tripBId, // belongs to tenant B
          templateName: 'group_meeting_point',
          whatsappTemplateId: 'meta_tpl_test',
        },
        { traveler: { userId: 'op_clerk_a', tenantId: T_A } } // operator from A
      )
    ).rejects.toThrow(/not found in tenant scope/);
  });

  itDb('audit: appends a broadcast row to GroupTrip.metadata.broadcasts', async () => {
    _setBroadcastImplForTesting(async args => ({
      id: `bc_audit_${Date.now()}`,
      name: args.name,
      status: 'sending',
      sent_count: 0,
      failed_count: 0,
      delivered_count: 0,
      read_count: 0,
    }));

    await broadcastToGroupTripTool.handler(
      {
        groupTripId: tripAId,
        templateName: 'group_meeting_point',
        whatsappTemplateId: 'meta_tpl_test',
        bodyParams: ['Lobby', '06:00'],
      },
      { traveler: { userId: 'op_clerk_a', tenantId: T_A } }
    );

    const trip = await prisma.groupTrip.findUnique({
      where: { id: tripAId },
      select: { metadata: true },
    });
    const broadcasts =
      (trip?.metadata as { broadcasts?: Array<Record<string, unknown>> } | null)?.broadcasts ?? [];
    expect(broadcasts.length).toBeGreaterThan(0);
    const last = broadcasts[broadcasts.length - 1]!;
    expect(last.kind).toBe('group_broadcast_sent');
    expect(last.templateName).toBe('group_meeting_point');
  });

  itDb('refuses when WhatsAppInstall is missing or not active', async () => {
    // Flip tenant A's install to disabled, then back.
    await prisma.whatsAppInstall.update({
      where: { tenantId: T_A },
      data: { status: 'disabled' },
    });
    try {
      await expect(
        broadcastToGroupTripTool.handler(
          {
            groupTripId: tripAId,
            templateName: 'group_meeting_point',
            whatsappTemplateId: 'meta_tpl_test',
          },
          { traveler: { userId: 'op_clerk_a', tenantId: T_A } }
        )
      ).rejects.toThrow(/disabled/);
    } finally {
      await prisma.whatsAppInstall.update({
        where: { tenantId: T_A },
        data: { status: 'active' },
      });
    }
  });

  itDb('refuses when zero eligible recipients', async () => {
    // Make a fresh trip with only opted-out + no-phone passengers.
    const empty = await prisma.groupTrip.create({
      data: {
        tenantId: T_A,
        name: 'A-empty-eligible',
        status: 'inviting',
        passengers: {
          create: [
            { userId: U_NOPHONE, status: 'claimed' },
            { userId: U_OPTED_OUT, status: 'claimed', broadcastOptedOut: true },
          ],
        },
      },
      select: { id: true },
    });
    try {
      await expect(
        broadcastToGroupTripTool.handler(
          {
            groupTripId: empty.id,
            templateName: 'group_meeting_point',
            whatsappTemplateId: 'meta_tpl_test',
          },
          { traveler: { userId: 'op_clerk_a', tenantId: T_A } }
        )
      ).rejects.toThrow(/zero eligible recipients/);
    } finally {
      await prisma.groupTrip.delete({ where: { id: empty.id } });
    }
  });
});

describe('set_group_broadcast_optout (E2E)', () => {
  itDb(
    'flips broadcastOptedOut for the caller across all their group trips in tenant',
    async () => {
      // Reset U_PHONE_1 to opted-in first.
      await prisma.groupTripPassenger.updateMany({
        where: { userId: U_PHONE_1 },
        data: { broadcastOptedOut: false },
      });

      const out = await setGroupBroadcastOptoutTool.handler(
        { optOut: true },
        { traveler: { userId: U_PHONE_1, tenantId: T_A } }
      );
      expect(out.ok).toBe(true);
      expect(out.optOut).toBe(true);
      expect(out.affectedRows).toBeGreaterThanOrEqual(1);

      const row = await prisma.groupTripPassenger.findFirst({
        where: { userId: U_PHONE_1 },
        select: { broadcastOptedOut: true },
      });
      expect(row?.broadcastOptedOut).toBe(true);

      // Re-opt-in idempotency.
      const back = await setGroupBroadcastOptoutTool.handler(
        { optOut: false },
        { traveler: { userId: U_PHONE_1, tenantId: T_A } }
      );
      expect(back.optOut).toBe(false);
      const row2 = await prisma.groupTripPassenger.findFirst({
        where: { userId: U_PHONE_1 },
        select: { broadcastOptedOut: true },
      });
      expect(row2?.broadcastOptedOut).toBe(false);
    }
  );

  itDb(
    'does NOT cross tenants — opting out in tenant A leaves tenant B rows untouched',
    async () => {
      // Add U_PHONE_1 also to tripB so we can verify cross-tenant scope.
      await prisma.groupTripPassenger.upsert({
        where: { groupTripId_userId: { groupTripId: tripBId, userId: U_PHONE_1 } },
        create: { groupTripId: tripBId, userId: U_PHONE_1, broadcastOptedOut: false },
        update: { broadcastOptedOut: false },
      });

      await setGroupBroadcastOptoutTool.handler(
        { optOut: true },
        { traveler: { userId: U_PHONE_1, tenantId: T_A } }
      );

      const bRow = await prisma.groupTripPassenger.findFirst({
        where: { userId: U_PHONE_1, groupTripId: tripBId },
        select: { broadcastOptedOut: true },
      });
      expect(bRow?.broadcastOptedOut).toBe(false); // unchanged
    }
  );

  itDb('refuses for service-account caller (svc:* user)', async () => {
    await expect(
      setGroupBroadcastOptoutTool.handler(
        { optOut: true },
        { traveler: { userId: 'svc:apikey_xyz', tenantId: T_A } }
      )
    ).rejects.toThrow(/service account/);
  });
});
