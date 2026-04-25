-- Tenant Markup v1 — combined migration (Track B1 + B3 + OTP design tables).
--
-- Single SQL file wrapped in one transaction so all schema changes land
-- atomically (Prisma does NOT auto-wrap on Postgres — see CLAUDE.md
-- "Pre-commit migration lint" — but a single migration.sql runs inside one
-- implicit PG transaction by default per `prisma migrate deploy`).
--
-- Sections:
--   A. Booking columns (cost / markup / take / pricingPolicyVersion +
--      tenantId,kind,createdAt index + backfill).
--   B. tenant_pricing_policies table (markup config per tenant, versioned).
--      Includes Postgres CHECK that markup_config is a JSON object — Eng A7.
--   C. Settlement denormalization columns (cost / tenant take / sendero take
--      / statusReason for the Eng A1 'pending_treasury' branch).
--   D. otp_delivery_attempts table (per the OTP design doc).
--   E. security_alerts table (per the OTP design doc).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- A. Booking — cost / markup / take denormalization (Track B1)
-- ─────────────────────────────────────────────────────────────────────

-- Supplier net rate, in micro-USDC. Null on legacy rows; backfilled
-- below from totalUsd to keep GMV reports consistent.
ALTER TABLE "bookings" ADD COLUMN "costMicroUsdc"        BIGINT;
-- Tenant GMV slice, in micro-USDC. Null when a booking pre-dates v1.
ALTER TABLE "bookings" ADD COLUMN "markupMicroUsdc"      BIGINT;
-- When markup was set as a percentage; null when set as an absolute amount.
ALTER TABLE "bookings" ADD COLUMN "markupBps"            INTEGER;
-- Denormalized for reporting — recomputable from markup snapshot, but a
-- direct column lets the GMV dashboard avoid a join + math each request.
ALTER TABLE "bookings" ADD COLUMN "senderoTakeMicroUsdc" BIGINT;
-- Human-readable audit pointer at the policy version that priced this
-- booking. The actual pin lives on metadata.policySnapshot (Eng A2/A3).
ALTER TABLE "bookings" ADD COLUMN "pricingPolicyVersion" INTEGER;

-- Backfill (Eng A10). Existing rows get cost = totalUsd × 1_000_000 and
-- markup = 0; markupBps stays NULL so the GMV dashboard can filter them
-- out via metadata.markupSource = 'pre_v1_no_markup_recorded'. We treat
-- pre-v1 bookings as cost-plus with no recorded margin.
UPDATE "bookings"
   SET "costMicroUsdc"   = ("totalUsd" * 1000000)::BIGINT,
       "markupMicroUsdc" = 0,
       "metadata"        =
         COALESCE("metadata", '{}'::jsonb)
         || jsonb_build_object('markupSource', 'pre_v1_no_markup_recorded')
 WHERE "totalUsd" IS NOT NULL;

-- Per-kind GMV report needs (tenantId, kind, createdAt) sorted on createdAt
-- so the finance dashboard can run "agency revenue by booking type per
-- month" without a full table scan (Eng A15).
CREATE INDEX "bookings_tenantId_kind_createdAt_idx"
  ON "bookings"("tenantId", "kind", "createdAt");

-- ─────────────────────────────────────────────────────────────────────
-- B. tenant_pricing_policies — versioned markup policy per tenant
-- ─────────────────────────────────────────────────────────────────────

-- Versioned, never updated. Latest row by (tenantId, version) wins. The
-- Booking pins both the human-readable version int AND the resolved
-- snapshot to metadata.policySnapshot so policy edits do not retro-price
-- open quotes (Eng A3).
CREATE TABLE "tenant_pricing_policies" (
    "id"                  TEXT NOT NULL,
    "tenantId"            TEXT NOT NULL,
    "version"             INTEGER NOT NULL,
    -- Discriminated-union JSON keyed by BookingKind. Validated by Zod in
    -- @sendero/billing/markup AND by the Postgres CHECK below as
    -- defense-in-depth (Eng A7).
    "markupConfig"        JSONB NOT NULL,
    -- Floor on tenant markup itself ($1 USDC default). Below this, the
    -- agency is not running a business — separate from the Sendero take
    -- floor, which is computed in code per tier.
    "floorMicroUsdc"      BIGINT NOT NULL DEFAULT 1000000,
    -- Self-imposed tenant ceiling. NULL = no ceiling (the platform never
    -- gates markup — this is for tenant back-office sanity only).
    "ceilingMicroUsdc"    BIGINT,
    -- 'add_to_customer' | 'deduct_from_markup' (DX D7 — self-documenting
    -- replacements for the original 'passthrough' / 'absorb' enum values).
    "senderoTakeBehavior" TEXT NOT NULL DEFAULT 'add_to_customer',
    -- Activation gate. Quote API rejects writes until true; Clerk webhook
    -- seeds an `activated=true, sandboxOnly=true` row at org.created so
    -- sandbox keys can call confirm_booking without a wizard pass (DX D1).
    "activated"           BOOLEAN NOT NULL DEFAULT FALSE,
    -- Sandbox-only seed flag. Production keys ignore sandboxOnly rows and
    -- still hit policy_inactive until a human activates a real policy.
    "sandboxOnly"         BOOLEAN NOT NULL DEFAULT FALSE,
    "createdById"         TEXT,
    "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pricing_policies_pkey" PRIMARY KEY ("id")
);

-- One row per (tenantId, version). New writes always insert with a
-- monotonically-increasing version — never UPDATE.
CREATE UNIQUE INDEX "tenant_pricing_policies_tenantId_version_key"
  ON "tenant_pricing_policies"("tenantId", "version");

-- Latest-policy lookup ("get current policy for tenant X"). Sorted DESC
-- on createdAt at the API layer.
CREATE INDEX "tenant_pricing_policies_tenantId_createdAt_idx"
  ON "tenant_pricing_policies"("tenantId", "createdAt");

-- Defense-in-depth (Eng A7): the markupConfig column MUST be a JSON
-- object (`{ flight: {...}, hotel: {...}, ... }`), never an array or
-- scalar. Zod also enforces this at the API boundary, but a malformed
-- direct DB write would still be caught here.
ALTER TABLE "tenant_pricing_policies"
  ADD CONSTRAINT "tenant_pricing_policies_markupConfig_object_check"
  CHECK (jsonb_typeof("markupConfig") = 'object');

ALTER TABLE "tenant_pricing_policies"
  ADD CONSTRAINT "tenant_pricing_policies_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_pricing_policies"
  ADD CONSTRAINT "tenant_pricing_policies_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- C. Settlement — cost / take denormalization for reconciliation
-- ─────────────────────────────────────────────────────────────────────

-- Mirrors the Booking columns for fast tenant GMV queries against the
-- settlement table (which already carries on-chain audit data). Source
-- of truth for per-leg amounts remains SettlementLeg.
ALTER TABLE "settlements" ADD COLUMN "costMicroUsdc"        BIGINT;
ALTER TABLE "settlements" ADD COLUMN "tenantTakeMicroUsdc"  BIGINT;
ALTER TABLE "settlements" ADD COLUMN "senderoTakeMicroUsdc" BIGINT;
-- Human-readable status reason (e.g., 'pending_treasury' when the
-- agency leg is held because tenant.circleWallet.address is null —
-- Eng A1). Surfaces in the tenant dashboard.
ALTER TABLE "settlements" ADD COLUMN "statusReason"         TEXT;

-- ─────────────────────────────────────────────────────────────────────
-- D. otp_delivery_attempts — audit trail for guest-claim OTP sends
-- ─────────────────────────────────────────────────────────────────────

-- Per OTP design: never store the OTP preimage. This table only records
-- THAT we sent something via channel X at time T, with the on-chain
-- claimCodeHash that was rotated to. Provider message id lets us
-- reconcile delivery webhooks.
CREATE TABLE "otp_delivery_attempts" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    -- Off-chain Trip.id (cuid). Cross-references onchainTripId for the
    -- on-chain hex32 form because event observers see the latter first.
    "tripId"            TEXT NOT NULL,
    -- On-chain bytes32 trip id, hex-encoded (`0x…`).
    "onchainTripId"     TEXT NOT NULL,
    -- 'whatsapp' | 'email' | 'sms'.
    "channel"           TEXT NOT NULL,
    "sentAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 'sent' | 'delivered' | 'failed' | 'rate_limited'.
    "deliveryStatus"    TEXT NOT NULL,
    -- Provider-specific id (Resend message id, Twilio sid, Meta wamid).
    -- Useful for receipt webhook reconciliation. Never PII.
    "providerMessageId" TEXT,
    -- Non-PII — 'invalid_phone', 'no_verified_contact', 'throttled', etc.
    "failureReason"     TEXT,
    -- Hex32 of the new claim code hash written on-chain.
    "rotatedHash"       TEXT NOT NULL,
    -- Tx hash of the setClaimCodeHash call. Null until the receipt lands.
    "rotatedTxHash"     TEXT,

    CONSTRAINT "otp_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- Per-trip timeline ("show me every OTP attempt for trip X").
CREATE INDEX "otp_delivery_attempts_tripId_sentAt_idx"
  ON "otp_delivery_attempts"("tripId", "sentAt");

-- Per-tenant timeline for the security dashboard + throttle-debug view.
CREATE INDEX "otp_delivery_attempts_tenantId_sentAt_idx"
  ON "otp_delivery_attempts"("tenantId", "sentAt");

ALTER TABLE "otp_delivery_attempts"
  ADD CONSTRAINT "otp_delivery_attempts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- E. security_alerts — operator inbox for high-severity events
-- ─────────────────────────────────────────────────────────────────────

-- Per OTP design: claim_lockout fans out to email + Slack + WhatsApp at
-- < 60s and persists an alert here for the dashboard inbox. tenantId is
-- nullable for the unknown-buyer case (lockout fired against an address
-- we have no Tenant row for — still useful to log for ops triage).
CREATE TABLE "security_alerts" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT,
    -- 'claim_lockout' | 'claim_lockout_unknown_buyer' | future kinds.
    "kind"           TEXT NOT NULL,
    -- 'low' | 'medium' | 'high' | 'critical'.
    "severity"       TEXT NOT NULL,
    -- Hex32 on-chain tripId for trip-related alerts; null for non-trip.
    "onchainTripId"  TEXT,
    -- Free-form context — addresses, timestamps, deep-link URLs. NEVER
    -- contains PII; the OTP design doc is explicit about this.
    "payload"        JSONB NOT NULL,
    -- Operator acknowledgement state for the dashboard inbox.
    "acknowledgedAt" TIMESTAMPTZ(6),
    "acknowledgedBy" TEXT,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- Per-tenant inbox view ("show my unacknowledged alerts").
CREATE INDEX "security_alerts_tenantId_createdAt_idx"
  ON "security_alerts"("tenantId", "createdAt");

-- Cross-tenant ops view ("show all critical claim lockouts platform-wide").
CREATE INDEX "security_alerts_kind_severity_createdAt_idx"
  ON "security_alerts"("kind", "severity", "createdAt");

ALTER TABLE "security_alerts"
  ADD CONSTRAINT "security_alerts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
