/**
 * Atomic Solana agent identity provisioning via the Metaplex Agent API.
 *
 * Replaces the two-step `mintCoreAgentIdentity` → `registerCoreAgentIdentity`
 * flow that was hitting `InvalidCoreAsset (0x4)` on `RegisterIdentityV1`:
 *
 *   - Plain `createCoreAsset(umi, { … })` produces a Core asset that
 *     the Agent Registry program rejects at PDA-derivation time —
 *     the program expects assets to be created by the Agent API,
 *     which attaches the AgentIdentity plugin in the same tx the
 *     asset is allocated.
 *   - `mintAndSubmitAgent` (this file) POSTs to
 *     `https://api.metaplex.com/v1/agents/mint`, gets back a single
 *     pre-built tx that creates the Core asset AND the on-chain
 *     `agent_identity` record atomically, then signs + sends with
 *     our platform key (the Umi identity).
 *
 * Owner vs signer:
 *   - The Metaplex Agent API requires `wallet` to sign the API-built
 *     tx (it pre-flights `getAccountInfo` and constructs a tx where
 *     the wallet pays rent + signs). A Squads V4 vault PDA can't
 *     sign directly, so we use the Sendero platform key as the
 *     on-chain owner.
 *   - The tenant's treasury (`ownerPubkey` on the input) is recorded
 *     in `OnchainIdentity.holderAddress` and in the off-chain
 *     `/agents/org/{tenantId}/metadata.json` — the registry
 *     attestation links the agent ↔ tenant via that metadata.
 *
 * Network resolution: derived from `SENDERO_SOLANA_RPC_URL`. devnet
 * RPC → `'solana-devnet'`. anything else (including unset, since the
 * Umi default is devnet) falls through to devnet to avoid accidental
 * mainnet mints. Override with `SENDERO_METAPLEX_AGENT_NETWORK`.
 */

import {
  mintAndSubmitAgent,
  type AgentMetadata,
  type SvmNetwork,
} from '@metaplex-foundation/mpl-agent-registry';

import { getUmi } from './_umi';

export interface MintAndRegisterAgentInput {
  /** Sendero tenant id — used in the agent description for explorer UX. */
  tenantId: string;
  /** Display name shown on the asset + Agent Registry record. */
  name: string;
  /**
   * Tenant's Solana DCW treasury (Squads V4 vault) pubkey. Recorded
   * in OnchainIdentity.holderAddress + the off-chain agent metadata
   * so the registry attestation links agent ↔ tenant. NOT used as
   * the on-chain owner of the Core asset (see file header for why).
   */
  ownerPubkey: string;
  /**
   * Off-chain ERC-8004-shaped metadata URI. Same
   * `/agents/org/{tenantId}/metadata.json` route as Arc — the
   * registry stores this URI on-chain and 3rd-party indexers fetch
   * it for the agent's service list, supported trust, etc.
   */
  identityUri: string;
  /**
   * Optional agent description. Defaults to a Sendero-shaped string
   * derived from name + tenantId.
   */
  description?: string;
  /**
   * Optional service list to register on-chain. Defaults to a single
   * `travel-booking` service pointing at the Sendero MCP.
   */
  services?: Array<{ name: string; endpoint: string }>;
}

export interface MintAndRegisterAgentResult {
  /** Core asset address — the canonical agent identity reference. */
  assetAddress: string;
  /** Solana tx signature (base58). */
  signature: string;
  /**
   * On-chain asset owner — always the Sendero platform key in v1.
   * The Metaplex Agent API requires the wallet to sign the API-built
   * tx, which a Squads V4 vault PDA can't do. The tenant's treasury
   * is recorded as `treasuryPubkey` and in the off-chain agent
   * metadata so the registry attestation links agent ↔ tenant.
   */
  ownerPubkey: string;
  /**
   * Tenant treasury pubkey (Squads V4 vault) — the canonical
   * tenant-side identity the agent attestation refers to. Stamped
   * on `OnchainIdentity.holderAddress` so DB queries find the
   * tenant by treasury.
   */
  treasuryPubkey: string;
  /** Tenant id (echo of input). */
  tenantId: string;
  /** Network the mint landed on. */
  network: SvmNetwork;
}

function resolveNetwork(): SvmNetwork {
  const override = process.env.SENDERO_METAPLEX_AGENT_NETWORK;
  if (override) {
    return override as SvmNetwork;
  }
  const rpcUrl = process.env.SENDERO_SOLANA_RPC_URL ?? '';
  if (rpcUrl.includes('devnet')) return 'solana-devnet';
  if (rpcUrl.includes('mainnet') || rpcUrl.includes('helius')) return 'solana-mainnet';
  return 'solana-devnet';
}

function defaultMcpEndpoint(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://app.sendero.travel') +
    '/api/mcp'
  );
}

export async function mintAndRegisterAgentIdentity(
  input: MintAndRegisterAgentInput
): Promise<MintAndRegisterAgentResult> {
  if (!input.tenantId) throw new Error('mintAndRegisterAgentIdentity: tenantId required');
  if (!input.identityUri) throw new Error('mintAndRegisterAgentIdentity: identityUri required');
  if (!input.name) throw new Error('mintAndRegisterAgentIdentity: name required');
  if (!input.ownerPubkey) throw new Error('mintAndRegisterAgentIdentity: ownerPubkey required');

  const umi = getUmi();
  const network = resolveNetwork();

  const description =
    input.description ??
    `Sendero corporate travel agent (tenant ${input.tenantId}). Books flights, stays, ground transit; settles in USDC; carries reputation across trips.`;

  const services = input.services ?? [{ name: 'travel-booking', endpoint: defaultMcpEndpoint() }];

  const agentMetadata: AgentMetadata = {
    type: 'agent',
    name: input.name,
    description,
    services,
    registrations: [],
    supportedTrust: [],
  };

  // The Metaplex Agent API requires `wallet` to sign the API-built
  // tx (the wallet pays rent + signs). Squads V4 vault PDAs can't
  // sign directly, so we mint with the platform key as the on-chain
  // owner. The tenant's treasury stays linked via:
  //   1. agentMetadata.registrations[].agentRegistry — the off-chain
  //      JSON the registry references via tokenURI carries the
  //      treasury pubkey (see metadataUriFor in provision-identity).
  //   2. OnchainIdentity.holderAddress — Sendero's DB row pairs
  //      tenant ↔ treasury ↔ asset.
  //
  // This mirrors how many ERC-8004 implementations work: the agent
  // identity is a Sendero attestation ABOUT the tenant, not the
  // tenant's self-sovereign NFT. The tenant's settlement / on-chain
  // power lives in the treasury; the agent record lives in the
  // registry and is Sendero-managed (so Sendero can rotate metadata
  // URIs, revoke compromised agents, etc.).
  //
  // Operational note: a future "graduate to tenant-owned" flow could
  // burn the Sendero-owned asset and re-mint via a Squads multisig
  // proposal. Out of scope for v1.
  const result = await mintAndSubmitAgent(
    umi,
    {},
    {
      wallet: umi.identity.publicKey,
      network,
      name: input.name,
      uri: input.identityUri,
      agentMetadata,
    },
    { commitment: 'confirmed' }
  );

  const signature =
    typeof (result.signature as unknown) === 'string'
      ? (result.signature as unknown as string)
      : Buffer.from(result.signature).toString('base64');

  return {
    assetAddress: result.assetAddress,
    signature,
    ownerPubkey: umi.identity.publicKey.toString(),
    treasuryPubkey: input.ownerPubkey,
    tenantId: input.tenantId,
    network,
  };
}
