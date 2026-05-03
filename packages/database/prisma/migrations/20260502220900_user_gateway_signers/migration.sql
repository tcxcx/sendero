-- T4 — Per-user Gateway signer.
--
-- Mirrors `tenant_gateway_signers` but keyed on userId so each traveler
-- has a self-custody EOA recorded as the Circle Gateway depositor for
-- their unified USDC balance. The reasoning for a viem EOA over the
-- DCW is the same as for tenants: Gateway's DOMAIN_SEPARATOR has no
-- chainId; Circle's signTypedData injects one and the signature
-- recovers to the wrong address.
--
-- The traveler's existing Wallet rows (DCW Arc + Solana) keep their
-- role for asset custody on those chains. The Gateway signer is
-- additive — it's the address Circle's /balances API recognizes.
--
-- Safe to run on a populated DB: pure CREATE TABLE, no existing-row
-- ALTERs.

CREATE TABLE "user_gateway_signers" (
  "userId"              TEXT        PRIMARY KEY,
  "address"             TEXT        NOT NULL,
  "encryptedPrivateKey" TEXT        NOT NULL,
  "kekVersion"          INTEGER     NOT NULL DEFAULT 1,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "user_gateway_signers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_gateway_signers_address_key"
    UNIQUE ("address")
);
