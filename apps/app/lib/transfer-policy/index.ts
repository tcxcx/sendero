/**
 * Public surface for the Sendero adapter to `@sendero/transfer-policy`.
 *
 * Consumers (agent dispatch, traveler spend route, caps editor)
 * should import from this barrel rather than the package itself
 * unless they need raw guard primitives.
 */

export { loadPolicyChain } from './load';
export type { LoadPolicyChainArgs } from './load';
export { prismaBudgetStore, prismaRateLimitStore } from './store';
