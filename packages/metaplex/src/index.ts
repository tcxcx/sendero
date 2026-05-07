/**
 * @sendero/metaplex — Solana-side parity helpers for Sendero's
 * Arc-native NFT surfaces.
 *
 * Three leaves:
 *   - `mintCoreTripStamp` — Metaplex Core single-asset mint for
 *     trip-lifecycle stamps. Real on-chain submit (Phase 4).
 *   - `mintCoreAgentIdentity` — Metaplex Core mint for tenant
 *     agency identity. Real on-chain submit (Phase 4.x.y.z). The
 *     full Agent Registry discoverability + delegation record
 *     layers on top via mpl-agent-identity once that SDK pins.
 *   - `describeTenantAgentRegistration` — Agent Registry intent
 *     descriptor (kept for the cross-chain mirror's awareness
 *     layer; agents NOT yet registered against the registry
 *     program get an intent row).
 *
 * All helpers share `getUmi()` so the platform keypair gets read
 * from env once per process.
 */

export { getUmi, resetUmi } from './_umi';
export {
  mintCoreTripStamp,
  type MintTripStampInput,
  type MintTripStampResult,
} from './mint-trip-stamp';
export {
  mintCoreAgentIdentity,
  type MintAgentIdentityInput,
  type MintAgentIdentityResult,
} from './mint-agent-identity';
export {
  stampAgentRegistryAttributes,
  type StampAgentRegistryAttributesInput,
  type StampAgentRegistryAttributesResult,
} from './stamp-agent-attributes';
export {
  describeTenantAgentRegistration,
  AGENT_REGISTRY_PROGRAM_ID,
  type RegisterTenantAgentInput,
  type RegisterTenantAgentIntent,
} from './register-tenant-agent';
