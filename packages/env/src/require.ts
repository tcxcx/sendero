/**
 * Required-env primitives, modeled on @bu/env from desk-v1.
 *
 * Two accessor shapes per variable:
 *   - `env.xxx()`        returns string | null — caller handles missing
 *   - `require*()`       throws with a scoped error message when missing
 *
 * Call sites that need a credential to run should use `require*()` so
 * the failure is loud and the env name lands in the stack trace. Call
 * sites that gracefully degrade (health check, landing page fallbacks)
 * stick with the nullable getters.
 */

export function resolve(key: string): string | null {
  const value = process.env[key];
  if (!value || value.length === 0) return null;
  return value;
}

export function required(key: string, scope: string): string {
  const value = resolve(key);
  if (!value) {
    throw new Error(
      `[${scope}] ${key} is not configured. Set it in .env.local (or your deployment env) before running this code path.`
    );
  }
  return value;
}

/**
 * Chain-level settings — the ones you hit every time an on-chain call
 * fires. Treating them as required means a misconfigured deploy fails
 * at first cast, not mid-workflow.
 */
export const requireArcRpcUrl = () => process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
export const requireArcChainId = () => Number(process.env.ARC_CHAIN_ID || 5042002);
export const requireEscrowAddress = () =>
  required(
    firstPresentKey(
      'ARC_ESCROW_ADDRESS',
      'NEXT_PUBLIC_ARC_ESCROW_ADDRESS',
      'SENDERO_GUEST_ESCROW',
      'NEXT_PUBLIC_SENDERO_GUEST_ESCROW'
    ),
    'onchain'
  );
export const requireTreasuryPrivateKey = () => required('TREASURY_PRIVATE_KEY', 'onchain');
export const requireAgentTokenId = () =>
  required(firstPresentKey('SENDERO_AGENT_TOKEN_ID', 'SENDERO_AGENT_ID'), 'onchain');

export const requireAnthropicApiKey = () => required('ANTHROPIC_API_KEY', 'agent');
export const requireDuffelApiToken = () => required('DUFFEL_API_TOKEN', 'duffel');
export const requireCircleApiKey = () => required('CIRCLE_API_KEY', 'circle');
export const requireCircleEntitySecret = () =>
  required(firstPresentKey('CIRCLE_ENTITY_SECRET', 'CIRCLE_ENTITY_SECRET_CIPHERTEXT'), 'circle');

export const requireDatabaseUrl = () => required('DATABASE_URL', 'db');

export const requireClerkSecretKey = () => required('CLERK_SECRET_KEY', 'auth');
export const requireClerkPublishableKey = () =>
  required('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'auth');

/**
 * Return the first key from the list whose env var is set, or the first
 * key as the "canonical" label for the error when none match.
 */
function firstPresentKey(...keys: string[]): string {
  for (const key of keys) {
    if (process.env[key]) return key;
  }
  return keys[0] ?? '';
}
