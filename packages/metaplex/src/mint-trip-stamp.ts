/**
 * Solana parity for Sendero's trip-stamp NFTs.
 *
 * Mints a Metaplex Core asset for the given (kind, primaryKey) so a
 * Solana-primary tenant gets the same trip-lifecycle attestations the
 * Arc tenants get via SenderoStamps (ERC-1155). Single-asset shape —
 * Core's modern standard, plug-in friendly, ~87% cheaper than legacy
 * Token Metadata.
 *
 * Authority model:
 *   - Sendero platform keypair signs (`updateAuthority` = platform).
 *     Same key as the gas station / agentic-commerce admin.
 *   - `owner` is the recipient pubkey — usually the traveler's DCW or
 *     the tenant's Squads vault. Caller passes it explicitly because
 *     Sendero owns the routing decision per stamp kind:
 *       - BoardingPass / Receipt → traveler DCW
 *       - TripPassport → traveler DCW (group mints handled in v2)
 *       - StayCheckIn / TripCompletion → traveler DCW
 *       - ItineraryMap → tenant agency wallet
 *
 * Idempotency lives in the caller (NftStamp UNIQUE on (kind, primaryKey)
 * matches the Arc path). v1 returns the asset address but does NOT
 * persist; the caller wraps in a Prisma transaction so on-chain success
 * gets durably recorded with the Solana-flavored fields.
 *
 * Phase 4.x will:
 *   - Wire this into the existing `mintStamp` tool with a chain branch.
 *   - Add the optional Collection plugin for grouping a tenant's
 *     stamps under one Core Collection (improves explorer UX +
 *     enables aggregate royalty / freeze rules).
 */

import {
  generateSigner,
  publicKey as toPublicKey,
  type PublicKey,
  type Signer,
  type TransactionBuilderSendAndConfirmOptions,
} from '@metaplex-foundation/umi';
import { create as createCoreAsset } from '@metaplex-foundation/mpl-core';

import { getUmi } from './_umi';

export interface MintTripStampInput {
  /** Stamp kind. Same enum as the Arc `mintStamp` tool. */
  kind:
    | 'BoardingPass'
    | 'SettlementReceipt'
    | 'ItineraryMap'
    | 'TripPassport'
    | 'StayCheckIn'
    | 'TripCompletion';
  /**
   * Recipient pubkey (base58). Traveler DCW for traveler-side stamps,
   * tenant agency wallet for tenant-side stamps.
   */
  ownerPubkey: string;
  /** Display name shown on Solana explorers + wallets. */
  name: string;
  /** Off-chain metadata URI — `https://...metadata.json` per ERC-7572-style schema. */
  uri: string;
  /**
   * Optional pre-generated asset signer. Pass when the caller wants a
   * deterministic asset address (e.g. derived from `(kind, primaryKey)`
   * for cross-environment idempotency); omit and we generate one.
   */
  assetSigner?: Signer;
  /** Send options (commitment, skip preflight, etc). */
  sendOptions?: TransactionBuilderSendAndConfirmOptions;
}

export interface MintTripStampResult {
  /** Asset address (Core asset is its own pubkey). Base58 string. */
  assetAddress: string;
  /** Solana tx signature (base58). */
  signature: string;
  /** Owner the asset was minted to. Echo of input. */
  ownerPubkey: string;
}

export async function mintCoreTripStamp(input: MintTripStampInput): Promise<MintTripStampResult> {
  if (!input.uri) throw new Error('mintCoreTripStamp: uri is required');
  if (!input.name) throw new Error('mintCoreTripStamp: name is required');
  if (!input.ownerPubkey) {
    throw new Error('mintCoreTripStamp: ownerPubkey is required');
  }

  const umi = getUmi();
  const asset = input.assetSigner ?? generateSigner(umi);
  const owner: PublicKey = toPublicKey(input.ownerPubkey);

  const builder = createCoreAsset(umi, {
    asset,
    name: input.name,
    uri: input.uri,
    owner,
  });

  const sendOptions = input.sendOptions ?? { confirm: { commitment: 'confirmed' } };
  const result = await builder.sendAndConfirm(umi, sendOptions);

  return {
    assetAddress: asset.publicKey.toString(),
    signature:
      typeof result.signature === 'string'
        ? result.signature
        : Buffer.from(result.signature).toString('base64'),
    ownerPubkey: input.ownerPubkey,
  };
}
