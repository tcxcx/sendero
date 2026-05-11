/**
 * Phase 4.x.y.z — real Solana agent identity mint via Metaplex Core.
 *
 * The Sendero Agent Registry parity story:
 *   - On Arc, ERC-8004 IdentityRegistry mints an agent NFT to the
 *     tenant's MSCA. The NFT IS the identity; reputation rows FK
 *     to it via `agentId` (uint256 sequential).
 *   - On Solana, the canonical agent identity is a Metaplex Core
 *     asset. Per the Metaplex skill: "Any Core asset already has a
 *     built-in wallet (Asset Signer PDA) via Core's Execute hook —
 *     the registry adds discoverable identity records and lets
 *     owners delegate an off-chain executive."
 *
 * v1 mints the FOUNDATION layer — the Core asset itself, owned by
 * the tenant's Solana DCW treasury. The full Agent Registry
 * discoverability + delegation record (via
 * @metaplex-foundation/mpl-agent-identity) layers on TOP of this
 * Core asset when that SDK pins. Either way the asset address is
 * the canonical identity reference; downstream rows already key on
 * it via OnchainIdentity.agentId.
 *
 * What "real" means here:
 *   - On-chain submit. Returns `{ assetAddress, signature }`.
 *   - Same `getUmi()` context as `mintCoreTripStamp` so platform
 *     keypair signs both stamp + identity mints.
 *   - `updateAuthority` = Sendero platform key (so future Agent
 *     Registry registration / delegation can be added in 4.x.y.zz
 *     without re-minting). `owner` = tenant treasury.
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

export interface MintAgentIdentityInput {
  /**
   * Tenant id — used in the asset name + metadata for explorer
   * UX. Also the natural anchor the caller persists into
   * OnchainIdentity.tenantId.
   */
  tenantId: string;
  /** Display name shown on Solana explorers + wallets. */
  name: string;
  /**
   * Owner pubkey (base58) — the tenant's Solana DCW treasury. Owns
   * the Core asset; Agent Registry delegation later (when SDK
   * pins) lets this owner authorize an off-chain executive.
   */
  ownerPubkey: string;
  /**
   * Off-chain metadata URI. Same `/agents/org/{tenantId}/metadata.json`
   * shape as Arc — the route returns ERC-8004-style agent identity
   * JSON with name, description, capabilities, links.
   */
  identityUri: string;
  /**
   * Optional pre-generated asset signer for deterministic asset
   * addresses (e.g. derived from tenantId for cross-environment
   * idempotency). Default generates one per call.
   */
  assetSigner?: Signer;
  /** Send options (commitment, skip preflight, etc). */
  sendOptions?: TransactionBuilderSendAndConfirmOptions;
}

export interface MintAgentIdentityResult {
  /** Asset address (Core asset is its own pubkey). Base58 string. This is the identity reference. */
  assetAddress: string;
  /** Solana tx signature (base58). */
  signature: string;
  /** Owner the asset was minted to. Echo of input. */
  ownerPubkey: string;
  /** Tenant id. Echo of input. */
  tenantId: string;
}

export async function mintCoreAgentIdentity(
  input: MintAgentIdentityInput
): Promise<MintAgentIdentityResult> {
  if (!input.tenantId) throw new Error('mintCoreAgentIdentity: tenantId required');
  if (!input.identityUri) throw new Error('mintCoreAgentIdentity: identityUri required');
  if (!input.name) throw new Error('mintCoreAgentIdentity: name required');
  if (!input.ownerPubkey) throw new Error('mintCoreAgentIdentity: ownerPubkey required');

  // Validate base58 — throws on invalid pubkey before submitting.
  const owner: PublicKey = toPublicKey(input.ownerPubkey);

  const umi = getUmi();
  const asset = input.assetSigner ?? generateSigner(umi);

  const builder = createCoreAsset(umi, {
    asset,
    name: input.name,
    uri: input.identityUri,
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
    tenantId: input.tenantId,
  };
}
