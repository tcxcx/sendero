-- CreateEnum
CREATE TYPE "BillingTier" AS ENUM ('free', 'pro', 'business', 'enterprise');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'paused', 'incomplete');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('agency_admin', 'finance', 'traveler', 'guest');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('draft', 'searching', 'awaiting_approval', 'booked', 'in_progress', 'completed', 'canceled', 'failed');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'ticketed', 'canceled', 'refunded', 'failed');

-- CreateEnum
CREATE TYPE "BookingKind" AS ENUM ('flight', 'hotel', 'rail', 'car', 'other');

-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('airline', 'hotel', 'dmc', 'rail', 'car_rental', 'other');

-- CreateEnum
CREATE TYPE "SupplierVisibility" AS ENUM ('public', 'tenant_private');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('active', 'inactive', 'blacklisted', 'pending_review');

-- CreateEnum
CREATE TYPE "MeterStatus" AS ENUM ('paid', 'free', 'rejected');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed', 'reverted');

-- CreateEnum
CREATE TYPE "SettlementLegKind" AS ENUM ('supplier', 'agency', 'rail', 'validator', 'refund', 'fee', 'other');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('preference', 'observation', 'fact', 'relation', 'trip_event', 'policy_note');

-- CreateEnum
CREATE TYPE "PreferenceCategory" AS ENUM ('seat', 'cabin_class', 'carrier', 'meal', 'hotel_chain', 'hotel_room_type', 'bag_allowance', 'layover_tolerance', 'departure_time', 'price_ceiling');

-- CreateEnum
CREATE TYPE "PreferenceSignal" AS ENUM ('approve', 'reject', 'select', 'skip');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('whatsapp', 'slack', 'email', 'web');

-- CreateEnum
CREATE TYPE "NanopayBatchStatus" AS ENUM ('pending', 'settling', 'settled', 'failed');

-- CreateEnum
CREATE TYPE "CapPeriod" AS ENUM ('daily', 'monthly');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "billingTier" "BillingTier" NOT NULL DEFAULT 'free',
    "fiscalCountry" TEXT,
    "arcAddress" TEXT,
    "parentTenantId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "imageUrl" TEXT,
    "mscaAddress" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'traveler',
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMPTZ(6),
    "joinedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clerkSubId" TEXT,
    "tier" "BillingTier" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "meterBalanceMicro" BIGINT NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT,
    "travelerId" TEXT,
    "createdById" TEXT,
    "intent" JSONB NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'draft',
    "events" JSONB NOT NULL DEFAULT '[]',
    "settlementRef" TEXT,
    "cfdiRef" TEXT,
    "reputationScore" INTEGER,
    "totalUsdc" DECIMAL(18,6),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdById" TEXT,
    "kind" "BookingKind" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "pnr" TEXT,
    "totalUsd" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "rawDuffel" JSONB,
    "segments" JSONB,
    "metadata" JSONB,
    "bookedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdById" TEXT,
    "kind" "SupplierKind" NOT NULL,
    "visibility" "SupplierVisibility" NOT NULL DEFAULT 'public',
    "status" "SupplierStatus" NOT NULL DEFAULT 'active',
    "name" TEXT NOT NULL,
    "iataCode" TEXT,
    "country" TEXT,
    "arcAddress" TEXT,
    "commissionBps" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "gatewayBalanceMicro" BIGINT NOT NULL DEFAULT 0,
    "label" TEXT,
    "lastSeenAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_events" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,
    "userId" TEXT,
    "payerAddress" TEXT,
    "toolName" TEXT NOT NULL,
    "priceMicroUsdc" BIGINT NOT NULL,
    "status" "MeterStatus" NOT NULL,
    "settlementRef" TEXT,
    "note" TEXT,
    "metadata" JSONB,

    CONSTRAINT "meter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "bookingId" TEXT,
    "grossMicroUsdc" BIGINT NOT NULL,
    "chain" TEXT NOT NULL,
    "chainId" INTEGER,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "txHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "initiatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_legs" (
    "id" UUID NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" "SettlementLegKind" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amountMicroUsdc" BIGINT NOT NULL,
    "txHash" TEXT,
    "index" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attestations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "agentId" TEXT NOT NULL,
    "validatorAddress" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "txHash" TEXT,
    "chain" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "tripId" TEXT,
    "clerkSessionId" TEXT,
    "threadContext" JSONB,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memories" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT 'sendero',
    "kind" "MemoryKind" NOT NULL,
    "summary" VARCHAR(240) NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMPTZ(6),
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preference_logs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "category" "PreferenceCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "signal" "PreferenceSignal" NOT NULL,
    "amountUsd" DECIMAL(12,2),
    "context" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preference_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_identities" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "ChannelKind" NOT NULL,
    "externalUserId" TEXT,
    "businessScopedUserId" TEXT,
    "parentBusinessScopedUserId" TEXT,
    "username" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_installs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "enterpriseName" TEXT,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "isEnterpriseInstall" BOOLEAN NOT NULL DEFAULT false,
    "authedUserId" TEXT NOT NULL,
    "installedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "slack_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_link_tokens" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_spend_caps" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" "CapPeriod" NOT NULL DEFAULT 'daily',
    "amountMicroUsdc" BIGINT NOT NULL,
    "hardCap" BOOLEAN NOT NULL DEFAULT true,
    "alertWebhookUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_spend_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nanopay_batches" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "NanopayBatchStatus" NOT NULL DEFAULT 'pending',
    "totalMicroUsdc" BIGINT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "windowEndedAt" TIMESTAMPTZ(6) NOT NULL,
    "txHash" TEXT,
    "chain" TEXT DEFAULT 'arc-testnet',
    "settledAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "nanopay_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_clerkOrgId_key" ON "tenants"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_parentTenantId_idx" ON "tenants"("parentTenantId");

-- CreateIndex
CREATE INDEX "tenants_createdAt_idx" ON "tenants"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkUserId_key" ON "users"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mscaAddress_key" ON "users"("mscaAddress");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "memberships_tenantId_role_idx" ON "memberships"("tenantId", "role");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_userId_key" ON "memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_clerkSubId_key" ON "subscriptions"("clerkSubId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "policies_tenantId_isDefault_idx" ON "policies"("tenantId", "isDefault");

-- CreateIndex
CREATE INDEX "policies_tenantId_createdAt_idx" ON "policies"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenantId_slug_key" ON "policies"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "trips_tenantId_createdAt_idx" ON "trips"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "trips_tenantId_status_idx" ON "trips"("tenantId", "status");

-- CreateIndex
CREATE INDEX "trips_policyId_idx" ON "trips"("policyId");

-- CreateIndex
CREATE INDEX "trips_travelerId_idx" ON "trips"("travelerId");

-- CreateIndex
CREATE INDEX "trips_createdById_idx" ON "trips"("createdById");

-- CreateIndex
CREATE INDEX "bookings_tenantId_createdAt_idx" ON "bookings"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_tripId_idx" ON "bookings"("tripId");

-- CreateIndex
CREATE INDEX "bookings_supplierId_idx" ON "bookings"("supplierId");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenantId_externalId_key" ON "bookings"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "suppliers_visibility_status_idx" ON "suppliers"("visibility", "status");

-- CreateIndex
CREATE INDEX "suppliers_kind_idx" ON "suppliers"("kind");

-- CreateIndex
CREATE INDEX "suppliers_iataCode_idx" ON "suppliers"("iataCode");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_iataCode_key" ON "suppliers"("tenantId", "iataCode");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_chainId_address_key" ON "wallets"("userId", "chainId", "address");

-- CreateIndex
CREATE INDEX "meter_events_tenantId_at_idx" ON "meter_events"("tenantId", "at");

-- CreateIndex
CREATE INDEX "meter_events_userId_at_idx" ON "meter_events"("userId", "at");

-- CreateIndex
CREATE INDEX "meter_events_toolName_at_idx" ON "meter_events"("toolName", "at");

-- CreateIndex
CREATE INDEX "meter_events_status_at_idx" ON "meter_events"("status", "at");

-- CreateIndex
CREATE INDEX "settlements_tenantId_createdAt_idx" ON "settlements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "settlements_bookingId_idx" ON "settlements"("bookingId");

-- CreateIndex
CREATE INDEX "settlements_tripId_idx" ON "settlements"("tripId");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlement_legs_settlementId_index_idx" ON "settlement_legs"("settlementId", "index");

-- CreateIndex
CREATE INDEX "settlement_legs_toAddress_idx" ON "settlement_legs"("toAddress");

-- CreateIndex
CREATE INDEX "attestations_tenantId_at_idx" ON "attestations"("tenantId", "at");

-- CreateIndex
CREATE INDEX "attestations_tripId_idx" ON "attestations"("tripId");

-- CreateIndex
CREATE INDEX "attestations_agentId_idx" ON "attestations"("agentId");

-- CreateIndex
CREATE INDEX "sessions_tenantId_createdAt_idx" ON "sessions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "sessions_tripId_idx" ON "sessions"("tripId");

-- CreateIndex
CREATE INDEX "sessions_clerkSessionId_idx" ON "sessions"("clerkSessionId");

-- CreateIndex
CREATE INDEX "agent_memories_tenantId_subjectId_kind_idx" ON "agent_memories"("tenantId", "subjectId", "kind");

-- CreateIndex
CREATE INDEX "agent_memories_tenantId_agentId_createdAt_idx" ON "agent_memories"("tenantId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "preference_logs_tenantId_subjectId_category_idx" ON "preference_logs"("tenantId", "subjectId", "category");

-- CreateIndex
CREATE INDEX "preference_logs_tenantId_createdAt_idx" ON "preference_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_identities_tenantId_kind_idx" ON "channel_identities"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "channel_identities_userId_idx" ON "channel_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_identities_tenantId_kind_businessScopedUserId_key" ON "channel_identities"("tenantId", "kind", "businessScopedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_identities_tenantId_kind_externalUserId_key" ON "channel_identities"("tenantId", "kind", "externalUserId");

-- CreateIndex
CREATE INDEX "slack_installs_tenantId_idx" ON "slack_installs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_installs_enterpriseId_teamId_key" ON "slack_installs"("enterpriseId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_link_tokens_token_key" ON "whatsapp_link_tokens"("token");

-- CreateIndex
CREATE INDEX "whatsapp_link_tokens_tenantId_userId_idx" ON "whatsapp_link_tokens"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "whatsapp_link_tokens_expiresAt_idx" ON "whatsapp_link_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "tenant_spend_caps_tenantId_idx" ON "tenant_spend_caps"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_spend_caps_tenantId_period_key" ON "tenant_spend_caps"("tenantId", "period");

-- CreateIndex
CREATE INDEX "nanopay_batches_tenantId_status_windowStartedAt_idx" ON "nanopay_batches"("tenantId", "status", "windowStartedAt");

-- CreateIndex
CREATE INDEX "nanopay_batches_status_windowEndedAt_idx" ON "nanopay_batches"("status", "windowEndedAt");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parentTenantId_fkey" FOREIGN KEY ("parentTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_travelerId_fkey" FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_events" ADD CONSTRAINT "meter_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_events" ADD CONSTRAINT "meter_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preference_logs" ADD CONSTRAINT "preference_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_installs" ADD CONSTRAINT "slack_installs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_link_tokens" ADD CONSTRAINT "whatsapp_link_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_link_tokens" ADD CONSTRAINT "whatsapp_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_spend_caps" ADD CONSTRAINT "tenant_spend_caps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nanopay_batches" ADD CONSTRAINT "nanopay_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

