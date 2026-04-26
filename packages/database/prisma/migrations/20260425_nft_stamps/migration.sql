-- NftStamp + NftStampOwnership — souvenir collectibles minted into the
-- SenderoStamps ERC-1155 contract on Arc-Testnet. (kind, primaryKey)
-- UNIQUE gives application-layer idempotency since the contract
-- assigns sequential tokenIds.

CREATE TABLE "nft_stamps" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "tripId"      TEXT,
    "bookingId"   TEXT,
    "travelerId"  TEXT,
    "kind"        TEXT NOT NULL,
    "primaryKey"  TEXT NOT NULL,
    "tokenId"     TEXT NOT NULL,
    "contract"    TEXT NOT NULL,
    "tenantSlug"  TEXT NOT NULL,
    "uri"         TEXT NOT NULL,
    "blobUrl"     TEXT,
    "caption"     TEXT,
    "metadata"    JSONB,
    "mintTxHash"  TEXT,
    "mintTxId"    TEXT,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "mintedAt"    TIMESTAMPTZ(6),
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "nft_stamps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nft_stamps_kind_primaryKey_key" ON "nft_stamps"("kind", "primaryKey");
CREATE UNIQUE INDEX "nft_stamps_contract_tokenId_key" ON "nft_stamps"("contract", "tokenId");
CREATE INDEX "nft_stamps_tenantId_mintedAt_idx" ON "nft_stamps"("tenantId", "mintedAt");
CREATE INDEX "nft_stamps_travelerId_mintedAt_idx" ON "nft_stamps"("travelerId", "mintedAt");
CREATE INDEX "nft_stamps_tripId_idx" ON "nft_stamps"("tripId");
CREATE INDEX "nft_stamps_status_idx" ON "nft_stamps"("status");

ALTER TABLE "nft_stamps" ADD CONSTRAINT "nft_stamps_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nft_stamps" ADD CONSTRAINT "nft_stamps_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nft_stamps" ADD CONSTRAINT "nft_stamps_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nft_stamps" ADD CONSTRAINT "nft_stamps_travelerId_fkey"
    FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "nft_stamp_ownerships" (
    "id"           TEXT NOT NULL,
    "stampId"      TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "ownerUserId"  TEXT,
    "balance"      BIGINT NOT NULL DEFAULT 0,
    "updatedAt"    TIMESTAMPTZ(6) NOT NULL,
    "lastTxHash"   TEXT,
    "lastBlock"    BIGINT,

    CONSTRAINT "nft_stamp_ownerships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nft_stamp_ownerships_stampId_ownerAddress_key"
    ON "nft_stamp_ownerships"("stampId", "ownerAddress");
CREATE INDEX "nft_stamp_ownerships_ownerAddress_idx" ON "nft_stamp_ownerships"("ownerAddress");
CREATE INDEX "nft_stamp_ownerships_ownerUserId_idx" ON "nft_stamp_ownerships"("ownerUserId");

ALTER TABLE "nft_stamp_ownerships" ADD CONSTRAINT "nft_stamp_ownerships_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "nft_stamps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nft_stamp_ownerships" ADD CONSTRAINT "nft_stamp_ownerships_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
