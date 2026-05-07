/**
 * Phase 4.x.y.zz — Agent Registry attributes stamped on the existing
 * Core asset.
 *
 * Layers structured agent metadata on TOP of the Core asset minted
 * by `mintCoreAgentIdentity` (Phase 4.x.y.z). Adds an `Attributes`
 * plugin via mpl-core's `addPluginV1`, encoding the same fields the
 * formal Metaplex Agent Registry would store:
 *   - role           : 'agent'
 *   - registryStatus : 'intent' (flips to 'registered' when the
 *                      official mpl-agent-identity SDK ships and an
 *                      indexer promotes the attributes into a real
 *                      registry record)
 *   - tenantId       : Sendero tenant id (anchors back to Postgres)
 *   - name           : display name
 *   - capabilities   : comma-separated capability list
 *   - metadataUri    : redundant with asset.uri, kept explicit so
 *                      indexers don't have to follow off-chain JSON
 *   - senderoSchema  : 'v1' (allows future versioning without
 *                      re-stamping every tenant)
 *
 * Why an interim layer instead of the formal Agent Registry submit:
 *   The umi `@metaplex-foundation/mpl-agent-identity` SDK isn't
 *   published to npm yet. Building against the on-chain IDL directly
 *   would lock us to a moving target. Core's Attributes plugin is a
 *   real on-chain artifact, owned by the same authority, indexable
 *   today. When the formal SDK ships, an indexer can scan
 *   `senderoSchema='v1'` Core assets and promote them into proper
 *   registry records — no re-mint, no data loss.
 *
 * Idempotency:
 *   Reads the asset's current plugin state and skips if a Sendero
 *   v1 attribute set is already present. Safe to call from the
 *   provisioning hook, the retry sweeper, or both.
 */

import { addPlugin, fetchAsset } from '@metaplex-foundation/mpl-core';
import {
  publicKey as toPublicKey,
  type TransactionBuilderSendAndConfirmOptions,
} from '@metaplex-foundation/umi';

import { getUmi } from './_umi';

export interface StampAgentRegistryAttributesInput {
  /** Existing Core asset address (from mintCoreAgentIdentity result). */
  assetAddress: string;
  /** Sendero tenant id — anchors the on-chain attribute set back to Postgres. */
  tenantId: string;
  /** Display name. */
  name: string;
  /**
   * Capability tags. Defaults to Sendero's canonical travel-agent
   * surface: search / book / settle / refund / handoff.
   */
  capabilities?: string[];
  /** Off-chain metadata URI — the same `/agents/org/{tenantId}/metadata.json`. */
  metadataUri: string;
  sendOptions?: TransactionBuilderSendAndConfirmOptions;
}

export interface StampAgentRegistryAttributesResult {
  status: 'stamped' | 'already_stamped';
  /** Tx signature when status='stamped'; null when status='already_stamped'. */
  signature: string | null;
  assetAddress: string;
}

/** Sentinel attribute key — presence indicates Sendero already stamped this asset. */
const SENDERO_SCHEMA_KEY = 'senderoSchema';
const SENDERO_SCHEMA_VERSION = 'v1';

const DEFAULT_CAPABILITIES = ['search', 'book', 'settle', 'refund', 'handoff'];

export async function stampAgentRegistryAttributes(
  input: StampAgentRegistryAttributesInput
): Promise<StampAgentRegistryAttributesResult> {
  if (!input.assetAddress) throw new Error('stampAgentRegistryAttributes: assetAddress required');
  if (!input.tenantId) throw new Error('stampAgentRegistryAttributes: tenantId required');
  if (!input.name) throw new Error('stampAgentRegistryAttributes: name required');
  if (!input.metadataUri) {
    throw new Error('stampAgentRegistryAttributes: metadataUri required');
  }

  const umi = getUmi();
  const assetPk = toPublicKey(input.assetAddress);

  // Idempotency check — read the asset's current plugin state. If
  // an Attributes plugin with our sentinel key is already present,
  // we've already stamped this tenant; skip the on-chain call.
  const asset = await fetchAsset(umi, assetPk);
  const attrs = asset.attributes?.attributeList ?? [];
  const alreadyStamped = attrs.some(
    a => a.key === SENDERO_SCHEMA_KEY && a.value === SENDERO_SCHEMA_VERSION
  );
  if (alreadyStamped) {
    return { status: 'already_stamped', signature: null, assetAddress: input.assetAddress };
  }

  const capabilities = (input.capabilities ?? DEFAULT_CAPABILITIES).join(',');

  const builder = addPlugin(umi, {
    asset: assetPk,
    plugin: {
      type: 'Attributes',
      attributeList: [
        { key: SENDERO_SCHEMA_KEY, value: SENDERO_SCHEMA_VERSION },
        { key: 'role', value: 'agent' },
        { key: 'registryStatus', value: 'intent' },
        { key: 'tenantId', value: input.tenantId },
        { key: 'name', value: input.name },
        { key: 'capabilities', value: capabilities },
        { key: 'metadataUri', value: input.metadataUri },
      ],
    },
  });

  const sendOptions = input.sendOptions ?? { confirm: { commitment: 'confirmed' } };
  const result = await builder.sendAndConfirm(umi, sendOptions);
  const signature =
    typeof result.signature === 'string'
      ? result.signature
      : Buffer.from(result.signature).toString('base64');

  return { status: 'stamped', signature, assetAddress: input.assetAddress };
}
