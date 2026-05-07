/**
 * Phase 4.x.y.zzz — formal Solana Agent Registry record submission.
 *
 * Layered on top of the Phase 4.x.y.z Core mint and the 4.x.y.zz
 * Attributes plugin. Calls `registerIdentityV1` from
 * @metaplex-foundation/mpl-agent-registry against the existing Core
 * asset to create the on-chain `agent_identity` PDA — the canonical
 * registry record that ERC-8004 indexers + Metaplex tooling read.
 *
 * After registration:
 *   - findAgentIdentityV2Pda(asset) returns the PDA address.
 *   - safeFetchAgentIdentityV2(pda) returns the on-chain record (no
 *     longer null).
 *   - The asset's plugin list includes `AgentIdentity` lifecycle
 *     hooks for Transfer / Update / Execute (in addition to the
 *     Attributes plugin we stamped in 4.x.y.zz).
 *
 * The Attributes plugin's `registryStatus='intent'` value stays as-is
 * — it's a Sendero-issued tag indexable by 3rd parties without
 * needing a PDA fetch. The on-chain registration IS authoritative;
 * the attribute is a hint. A future indexer pass can flip the value
 * to 'registered' via mpl-core's updatePlugin if useful.
 *
 * Idempotency: the program returns `AgentIdentityAlreadyRegistered`
 * (error code 9) when called against an already-registered asset.
 * We catch it and return `{ status: 'already_registered' }` so
 * sweepers can call this safely.
 */

import {
  registerIdentityV1,
  safeFetchAgentIdentityV2,
  findAgentIdentityV2Pda,
} from '@metaplex-foundation/mpl-agent-registry';
import {
  publicKey as toPublicKey,
  type PublicKey,
  type TransactionBuilderSendAndConfirmOptions,
} from '@metaplex-foundation/umi';

import { getUmi } from './_umi';

export interface RegisterIdentityInput {
  /** Existing Core asset address (from mintCoreAgentIdentity result). */
  assetAddress: string;
  /**
   * Off-chain ERC-8004 registration document URI. Same shape as the
   * existing `metadataUriFor('org', tenantId)` route since Sendero's
   * agent metadata page IS the registration document
   * (services + supportedTrust + active flag etc.).
   */
  agentRegistrationUri: string;
  /** Optional collection address — recommended but not required. */
  collectionAddress?: string;
  sendOptions?: TransactionBuilderSendAndConfirmOptions;
}

export type RegisterIdentityResult =
  | {
      status: 'registered';
      assetAddress: string;
      identityPda: string;
      signature: string;
    }
  | {
      status: 'already_registered';
      assetAddress: string;
      identityPda: string;
      /** No new tx fired — null. */
      signature: null;
    };

export async function registerCoreAgentIdentity(
  input: RegisterIdentityInput
): Promise<RegisterIdentityResult> {
  if (!input.assetAddress) throw new Error('registerCoreAgentIdentity: assetAddress required');
  if (!input.agentRegistrationUri) {
    throw new Error('registerCoreAgentIdentity: agentRegistrationUri required');
  }

  const umi = getUmi();
  const asset: PublicKey = toPublicKey(input.assetAddress);
  const collection = input.collectionAddress ? toPublicKey(input.collectionAddress) : undefined;

  // Idempotency check — read the on-chain identity PDA. If it exists,
  // skip the submit.
  const identityPda = findAgentIdentityV2Pda(umi, { asset });
  const existing = await safeFetchAgentIdentityV2(umi, identityPda);
  if (existing !== null) {
    return {
      status: 'already_registered',
      assetAddress: input.assetAddress,
      identityPda: identityPda[0].toString(),
      signature: null,
    };
  }

  const builder = registerIdentityV1(umi, {
    asset,
    collection,
    agentRegistrationUri: input.agentRegistrationUri,
  });

  const sendOptions = input.sendOptions ?? { confirm: { commitment: 'confirmed' } };
  const result = await builder.sendAndConfirm(umi, sendOptions);
  const signature =
    typeof result.signature === 'string'
      ? result.signature
      : Buffer.from(result.signature).toString('base64');

  return {
    status: 'registered',
    assetAddress: input.assetAddress,
    identityPda: identityPda[0].toString(),
    signature,
  };
}
