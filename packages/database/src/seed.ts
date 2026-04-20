/**
 * @sendero/database — demo seed.
 *
 * One-shot: `bun run db:seed` creates a complete end-to-end demo tenant
 * ("SP Corporate Travel"), a corp policy ("Vale-2026"), one admin user
 * (rodrigo@spct.com.br), one public supplier (British Airways), and one
 * in-progress Trip with a sample Booking + MeterEvent. Safe to re-run —
 * uses upserts keyed on stable unique fields.
 */

import { prisma } from './index.js';
import type { PolicyRules, TripEvent } from './types.js';

const VALE_2026: PolicyRules = {
  maxFlightUsd: 4500,
  maxNightUsd: 300,
  intlCabinMinHours: 6,
  intlCabinRequired: 'business',
  domesticCabin: 'economy',
  preferredCarriers: ['LA', 'AV', 'CM', 'BA'],
  blacklistSuppliers: [],
  requireApproverOverUsd: 2000,
  fiscalCountry: 'BR',
};

async function main() {
  console.log('[seed] start');

  // 1. Tenant ---------------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'sp-corporate-travel' },
    create: {
      slug: 'sp-corporate-travel',
      clerkOrgId: 'org_demo_spct',
      displayName: 'SP Corporate Travel',
      billingTier: 'business',
      fiscalCountry: 'BR',
      metadata: { timezone: 'America/Sao_Paulo', website: 'https://spct.com.br' },
    },
    update: {},
  });
  console.log(`[seed] tenant → ${tenant.slug} (${tenant.id})`);

  // 2. Subscription ---------------------------------------------------------
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      tier: 'business',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
    update: {},
  });

  // 3. User -----------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { email: 'rodrigo@spct.com.br' },
    create: {
      email: 'rodrigo@spct.com.br',
      clerkUserId: 'user_demo_rodrigo',
      displayName: 'Rodrigo Almeida',
      mscaAddress: '0x1111111111111111111111111111111111111111',
    },
    update: {},
  });
  console.log(`[seed] user → ${user.email}`);

  // 4. Membership (admin) ---------------------------------------------------
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: 'agency_admin',
      status: 'active',
      joinedAt: new Date(),
    },
    update: { role: 'agency_admin' },
  });

  // 5. Wallet ---------------------------------------------------------------
  await prisma.wallet.upsert({
    where: {
      userId_chainId_address: {
        userId: user.id,
        chainId: 5_042_002,
        address: '0x1111111111111111111111111111111111111111',
      },
    },
    create: {
      userId: user.id,
      chainId: 5_042_002,
      address: '0x1111111111111111111111111111111111111111',
      gatewayBalanceMicro: 250_000_000n, // $250 USDC
      label: 'arc-treasury',
      lastSeenAt: new Date(),
    },
    update: { lastSeenAt: new Date() },
  });

  // 6. Policy (Vale-2026) ---------------------------------------------------
  const policy = await prisma.policy.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'vale-corp-2026' } },
    create: {
      tenantId: tenant.id,
      slug: 'vale-corp-2026',
      displayName: 'Vale 2026 Corporate Travel Policy',
      rules: VALE_2026 as unknown as object,
      isDefault: true,
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: new Date('2026-12-31'),
    },
    update: { rules: VALE_2026 as unknown as object },
  });
  console.log(`[seed] policy → ${policy.slug}`);

  // 7. Supplier (British Airways, public) -----------------------------------
  const supplier = await prisma.supplier.upsert({
    where: { tenantId_iataCode: { tenantId: null as unknown as string, iataCode: 'BA' } },
    create: {
      tenantId: null,
      kind: 'airline',
      visibility: 'public',
      status: 'active',
      name: 'British Airways',
      iataCode: 'BA',
      country: 'GB',
      arcAddress: '0x2222222222222222222222222222222222222222',
      commissionBps: 150, // 1.5%
    },
    update: {},
  }).catch(async () => {
    // Postgres treats NULL as distinct in UNIQUE constraints, so upsert by find/create.
    const existing = await prisma.supplier.findFirst({
      where: { iataCode: 'BA', tenantId: null },
    });
    if (existing) return existing;
    return prisma.supplier.create({
      data: {
        tenantId: null,
        kind: 'airline',
        visibility: 'public',
        status: 'active',
        name: 'British Airways',
        iataCode: 'BA',
        country: 'GB',
        arcAddress: '0x2222222222222222222222222222222222222222',
        commissionBps: 150,
      },
    });
  });
  console.log(`[seed] supplier → ${supplier.name}`);

  // 8. Trip + Booking + MeterEvent -----------------------------------------
  const events: TripEvent[] = [
    { at: new Date().toISOString(), kind: 'user_msg', data: { text: 'GRU → LHR next Tue, business' } },
    { at: new Date().toISOString(), kind: 'tool_call', toolName: 'search_flights' },
    { at: new Date().toISOString(), kind: 'policy_check', data: { allowed: true } },
  ];

  const trip = await prisma.trip.upsert({
    where: { id: 'trip_demo_vale_001' }, // stable demo id
    create: {
      id: 'trip_demo_vale_001',
      tenantId: tenant.id,
      policyId: policy.id,
      travelerId: user.id,
      createdById: user.id,
      status: 'in_progress',
      intent: {
        origin: 'GRU',
        destination: 'LHR',
        departAt: '2026-04-28',
        returnAt: '2026-05-03',
        paxAdults: 1,
        cabin: 'business',
        purpose: 'Board meeting — Vale London office',
      },
      events: events as unknown as object,
      totalUsdc: '3200.00',
    },
    update: { status: 'in_progress', events: events as unknown as object },
  });
  console.log(`[seed] trip → ${trip.id}`);

  const booking = await prisma.booking.upsert({
    where: { tenantId_externalId: { tenantId: tenant.id, externalId: 'duffel_ord_demo_001' } },
    create: {
      tenantId: tenant.id,
      tripId: trip.id,
      supplierId: supplier.id,
      createdById: user.id,
      kind: 'flight',
      status: 'confirmed',
      externalId: 'duffel_ord_demo_001',
      pnr: 'ABC123',
      totalUsd: '3200.00',
      currency: 'USD',
      segments: [
        { from: 'GRU', to: 'LHR', carrier: 'BA', flight: 'BA246', departAt: '2026-04-28T22:45:00Z' },
        { from: 'LHR', to: 'GRU', carrier: 'BA', flight: 'BA247', departAt: '2026-05-03T14:30:00Z' },
      ],
      bookedAt: new Date(),
    },
    update: { status: 'confirmed' },
  });

  await prisma.meterEvent.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      payerAddress: '0x1111111111111111111111111111111111111111',
      toolName: 'search_flights',
      priceMicroUsdc: 5_000n, // $0.005
      status: 'paid',
      settlementRef: 'gw_demo_0x01',
      note: 'seed',
    },
  });

  // 9. Settlement + legs (sample fan-out) ----------------------------------
  const settlement = await prisma.settlement.create({
    data: {
      tenantId: tenant.id,
      tripId: trip.id,
      bookingId: booking.id,
      grossMicroUsdc: 3_200_000_000n,
      chain: 'arc-testnet',
      chainId: 5_042_002,
      status: 'confirmed',
      txHashes: ['0xdemo00000000000000000000000000000000000000000000000000000000beef'],
      confirmedAt: new Date(),
      legs: {
        create: [
          { kind: 'supplier',  toAddress: '0x2222222222222222222222222222222222222222', amountMicroUsdc: 3_152_000_000n, index: 0, txHash: '0xdemo...01' },
          { kind: 'agency',    toAddress: '0x3333333333333333333333333333333333333333', amountMicroUsdc: 40_000_000n,    index: 1, txHash: '0xdemo...02' },
          { kind: 'rail',      toAddress: '0x4444444444444444444444444444444444444444', amountMicroUsdc: 5_000_000n,     index: 2, txHash: '0xdemo...03' },
          { kind: 'validator', toAddress: '0x5555555555555555555555555555555555555555', amountMicroUsdc: 3_000_000n,     index: 3, txHash: '0xdemo...04' },
        ],
      },
    },
  });
  console.log(`[seed] settlement → ${settlement.id} (${settlement.legs?.length ?? 4} legs)`);

  // 10. Attestation (ERC-8004) ---------------------------------------------
  await prisma.attestation.create({
    data: {
      tenantId: tenant.id,
      tripId: trip.id,
      agentId: 'sendero:0x1111...',
      validatorAddress: '0x5555555555555555555555555555555555555555',
      stars: 5,
      chain: 'arc-testnet',
      txHash: '0xdemoattest0000000000000000000000000000000000000000000000000000beef',
    },
  });

  console.log('[seed] done ✓');
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
