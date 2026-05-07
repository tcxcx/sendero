/**
 * @sendero/metaplex — Solana-side parity helpers for Sendero's
 * Arc-native NFT surfaces.
 *
 * Two leaves:
 *   - `mintCoreTripStamp` — Metaplex Core single-asset mint.
 *     Real on-chain submit, Phase 4 v1.
 *   - `describeTenantAgentRegistration` — Agent Registry intent
 *     descriptor. Real submit lands in Phase 4.x once the umi
 *     mpl-agent-identity SDK stabilizes.
 *
 * Both helpers share `getUmi()` so the platform keypair gets read
 * from env once per process.
 */

export { getUmi, resetUmi } from './_umi';
export {
  mintCoreTripStamp,
  type MintTripStampInput,
  type MintTripStampResult,
} from './mint-trip-stamp';
export {
  describeTenantAgentRegistration,
  AGENT_REGISTRY_PROGRAM_ID,
  type RegisterTenantAgentInput,
  type RegisterTenantAgentIntent,
} from './register-tenant-agent';
