/**
 * Unified Balance delegate handles for `/api/transfer/spend`.
 *
 * The `transfer-spend/execute.ts` flow builds a multi-source spend
 * fan-out (one source per traveler DCW row) which doesn't fit the
 * single-call `unifiedGateway.spend` helper today. So we keep the
 * `{ kit, adapter }` shape the route expects — but BOTH come from
 * the centralized `@sendero/circle/unified-gateway` so kit instance
 * and adapter wiring stay consistent across the app.
 *
 * `kit` here is the App Kit `unifiedBalance` namespace (one instance
 * across the whole app). It exposes `deposit / depositFor / spend /
 * estimateSpend / getBalances / addDelegate / removeDelegate /
 * getDelegateStatus / initiateRemoveFund / removeFund` per the
 * Circle docs.
 *
 * - `getUnifiedBalanceDelegate()`     — viem-backed delegate
 *   (`SENDERO_UB_DELEGATE_PRIVATE_KEY`).
 * - `getCircleUnifiedBalanceDelegate()` — Circle Wallets-backed delegate
 *   for traveler-DCW spends (no private key on Sendero servers).
 *
 * Both return `null` when the relevant env is missing so the route can
 * 503 with a clear "configure delegate" message instead of crashing.
 */

import type { ViemAdapter } from '@circle-fin/adapter-viem-v2';
import type { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import {
  circleWalletsPrincipal,
  delegateViemPrincipal,
  getUnifiedBalanceNamespace,
} from '@sendero/circle';

type UnifiedBalanceNamespace = ReturnType<typeof getUnifiedBalanceNamespace>;

interface ViemDelegateHandle {
  kit: UnifiedBalanceNamespace;
  adapter: ViemAdapter;
}

interface CircleDelegateHandle {
  kit: UnifiedBalanceNamespace;
  adapter: ReturnType<typeof createCircleWalletsAdapter>;
}

let viemCached: ViemDelegateHandle | null = null;
let circleCached: CircleDelegateHandle | null = null;

export function getUnifiedBalanceDelegate(): ViemDelegateHandle | null {
  if (viemCached) return viemCached;
  const principal = delegateViemPrincipal();
  if (!principal || principal.kind !== 'viem') return null;
  viemCached = { kit: getUnifiedBalanceNamespace(), adapter: principal.adapter };
  return viemCached;
}

/**
 * Circle Wallets delegate. The principal factory wants an address; the
 * delegate model doesn't have a single address (it dispatches to many
 * traveler DCWs at spend time), so we pass `0x0…0` as a placeholder
 * and only consume the adapter. Caller must supply real source
 * addresses in `kit.spend({ from: [{ adapter, address }] })`.
 */
export function getCircleUnifiedBalanceDelegate(): CircleDelegateHandle | null {
  if (circleCached) return circleCached;
  const principal = circleWalletsPrincipal({
    address: '0x0000000000000000000000000000000000000000',
    label: 'circle-delegate',
  });
  if (!principal || principal.kind !== 'circle-wallets') return null;
  circleCached = { kit: getUnifiedBalanceNamespace(), adapter: principal.adapter };
  return circleCached;
}
