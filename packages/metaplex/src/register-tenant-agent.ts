/**
 * Solana parity for tenant agency identity (Arc-side ERC-8004).
 *
 * On Arc, every tenant gets an ERC-8004 IdentityRegistry NFT minted
 * to its Circle treasury MSCA — that's the canonical agent identity
 * that accumulates ReputationFeedback + ValidationCheck rows.
 *
 * On Solana the equivalent is a Metaplex Agent Registry record
 * (program: 1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p — see CLAUDE.md
 * Metaplex skill). It registers a wallet as an agent identity and
 * lets owners delegate execution. The Mint Agent API
 * (`mintAndSubmitAgent`) creates the Core asset + identity record
 * in a single tx — the recommended path for new agents.
 *
 * **Phase 4 v1 — intent only.**
 *
 * The Agent Registry program ABI on devnet is still settling and the
 * full umi SDK shape isn't a 1.x package yet. v1 ships an *intent*
 * helper that:
 *   - validates inputs (treasury pubkey, identity URI)
 *   - returns a deterministic registration descriptor the caller can
 *     persist into OnchainIdentity with status='intent'
 *   - logs what the on-chain submit WILL look like
 *
 * Phase 4.x lands the actual `mintAndSubmitAgent` call and flips the
 * status from `'intent'` → `'pending'` → `'minted'` matching the Arc
 * sweeper semantics.
 *
 * Cross-chain reputation mirror (Phase 5) reads from BOTH:
 *   - Arc IdentityRegistry events (existing path)
 *   - Solana Agent Registry events (added in 4.x)
 *
 * and aggregates into the same OnchainIdentity row identified by
 * (kind, tenantId). The `chain` field on OnchainIdentity (added in
 * 4.x) disambiguates dual-chain tenants.
 */

import { publicKey as toPublicKey } from '@metaplex-foundation/umi';

/** Solana Agent Registry program ID (devnet + mainnet). */
export const AGENT_REGISTRY_PROGRAM_ID =
  '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p';

export interface RegisterTenantAgentInput {
  /** Sendero tenant id — used by the caller to anchor the OnchainIdentity row. */
  tenantId: string;
  /** Tenant's Solana treasury (Squads V4 vault) pubkey. Owns the agent NFT. */
  treasuryPubkey: string;
  /** Display name on the Agent Registry record + Core asset. */
  name: string;
  /** Off-chain metadata URI — same `/agents/org/{tenantId}/metadata.json` shape. */
  identityUri: string;
}

export interface RegisterTenantAgentIntent {
  status: 'intent';
  /** Program that will receive the registration submit in Phase 4.x. */
  programId: string;
  tenantId: string;
  treasuryPubkey: string;
  name: string;
  identityUri: string;
  /**
   * Human-readable note for caller logs / OnchainIdentity.metadata.
   * Phase 4.x replaces this with the real signature + asset address.
   */
  note: string;
}

/**
 * Validate + describe the on-chain registration WITHOUT submitting.
 * Returns a descriptor that fits cleanly into `OnchainIdentity`
 * (status='intent', holderAddress=treasuryPubkey, metadataUri=identityUri).
 */
export function describeTenantAgentRegistration(
  input: RegisterTenantAgentInput
): RegisterTenantAgentIntent {
  if (!input.tenantId) throw new Error('describeTenantAgentRegistration: tenantId required');
  if (!input.identityUri) {
    throw new Error('describeTenantAgentRegistration: identityUri required');
  }
  if (!input.name) throw new Error('describeTenantAgentRegistration: name required');

  // Validate treasury pubkey shape (throws on invalid base58 / wrong length).
  toPublicKey(input.treasuryPubkey);

  return {
    status: 'intent',
    programId: AGENT_REGISTRY_PROGRAM_ID,
    tenantId: input.tenantId,
    treasuryPubkey: input.treasuryPubkey,
    name: input.name,
    identityUri: input.identityUri,
    note: 'Phase 4.x will submit via @metaplex-foundation/mpl-agent-identity once the SDK pins to a stable release. Until then, intent rows in OnchainIdentity carry status="intent" and the cross-chain mirror skips them.',
  };
}
