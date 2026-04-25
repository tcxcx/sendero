-- ERC-8004 dual reputation: per-org and per-user identity NFTs on Arc-Testnet
-- (IdentityRegistry 0x8004A8…), with denormalized reputation aggregations
-- (ReputationRegistry 0x8004B6…) and validation request/response state
-- (ValidationRegistry 0x8004Cb…). Atomic with wallet provisioning;
-- pending → minted | failed mirrors NftStamp.status semantics.

CREATE TABLE "onchain_identities" (
    "id"                    TEXT NOT NULL,
    "kind"                  TEXT NOT NULL,
    "tenantId"              TEXT,
    "userId"                TEXT,
    "chainId"               INTEGER NOT NULL,
    "contract"              TEXT NOT NULL,
    "agentId"               TEXT,
    "holderAddress"         TEXT NOT NULL,
    "metadataUri"           TEXT NOT NULL,
    "mintTxHash"            TEXT,
    "mintTxId"              TEXT,
    "mintedAt"              TIMESTAMPTZ(6),
    "status"                TEXT NOT NULL DEFAULT 'pending',
    "cachedStars"           DOUBLE PRECISION,
    "cachedFeedbackCount"   INTEGER NOT NULL DEFAULT 0,
    "cachedValidatorCount"  INTEGER NOT NULL DEFAULT 0,
    "cachedValidationCount" INTEGER NOT NULL DEFAULT 0,
    "cachedAt"              TIMESTAMPTZ(6),
    "attemptCount"          INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt"         TIMESTAMPTZ(6),
    "lastError"             TEXT,
    "createdAt"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onchain_identities_pkey" PRIMARY KEY ("id")
);

-- (contract, agentId) is the canonical on-chain identifier.
CREATE UNIQUE INDEX "onchain_identities_contract_agentId_key"
    ON "onchain_identities"("contract", "agentId");
-- Partial-unique enforced at the app layer: exactly one identity per
-- (kind='org', tenantId) and exactly one per (kind='user', userId).
CREATE UNIQUE INDEX "onchain_identities_kind_tenantId_key"
    ON "onchain_identities"("kind", "tenantId");
CREATE UNIQUE INDEX "onchain_identities_kind_userId_key"
    ON "onchain_identities"("kind", "userId");
CREATE INDEX "onchain_identities_holderAddress_idx"
    ON "onchain_identities"("holderAddress");
CREATE INDEX "onchain_identities_status_idx"
    ON "onchain_identities"("status");

ALTER TABLE "onchain_identities" ADD CONSTRAINT "onchain_identities_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onchain_identities" ADD CONSTRAINT "onchain_identities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "reputation_feedback" (
    "id"             TEXT NOT NULL,
    "subjectId"      TEXT NOT NULL,
    "fromIdentityId" TEXT,
    "fromAddress"    TEXT NOT NULL,
    "score"          INTEGER NOT NULL,
    "stars"          DOUBLE PRECISION NOT NULL,
    "tag"            TEXT,
    "feedbackHash"   TEXT NOT NULL,
    "uri"            TEXT,
    "txHash"         TEXT NOT NULL,
    "blockNumber"    BIGINT NOT NULL,
    "tripId"         TEXT,
    "bookingId"      TEXT,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reputation_feedback_txHash_key" ON "reputation_feedback"("txHash");
CREATE INDEX "reputation_feedback_subjectId_createdAt_idx"
    ON "reputation_feedback"("subjectId", "createdAt");
CREATE INDEX "reputation_feedback_fromIdentityId_idx"
    ON "reputation_feedback"("fromIdentityId");
CREATE INDEX "reputation_feedback_tripId_idx" ON "reputation_feedback"("tripId");

ALTER TABLE "reputation_feedback" ADD CONSTRAINT "reputation_feedback_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "onchain_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reputation_feedback" ADD CONSTRAINT "reputation_feedback_fromIdentityId_fkey"
    FOREIGN KEY ("fromIdentityId") REFERENCES "onchain_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reputation_feedback" ADD CONSTRAINT "reputation_feedback_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reputation_feedback" ADD CONSTRAINT "reputation_feedback_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "validation_checks" (
    "id"               TEXT NOT NULL,
    "subjectId"        TEXT NOT NULL,
    "validatorAddress" TEXT NOT NULL,
    "requestUri"       TEXT NOT NULL,
    "requestHash"      TEXT NOT NULL,
    "requestTxHash"    TEXT NOT NULL,
    "responseScore"    INTEGER,
    "responseTxHash"   TEXT,
    "tag"              TEXT,
    "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"       TIMESTAMPTZ(6),

    CONSTRAINT "validation_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "validation_checks_requestHash_key" ON "validation_checks"("requestHash");
CREATE INDEX "validation_checks_subjectId_idx" ON "validation_checks"("subjectId");

ALTER TABLE "validation_checks" ADD CONSTRAINT "validation_checks_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "onchain_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "reputation_policies" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "minStars"        DOUBLE PRECISION,
    "minTripCount"    INTEGER,
    "maxDisputeRatio" DOUBLE PRECISION,
    "requireKyc"      BOOLEAN NOT NULL DEFAULT false,
    "requireKyb"      BOOLEAN NOT NULL DEFAULT false,
    -- Default 'warn': non-blocking at launch. Admins flip to 'block'
    -- once they've reviewed surfaced violations in the dashboard.
    "enforcement"     TEXT NOT NULL DEFAULT 'warn',
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reputation_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reputation_policies_tenantId_key" ON "reputation_policies"("tenantId");

ALTER TABLE "reputation_policies" ADD CONSTRAINT "reputation_policies_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
