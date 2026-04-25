/**
 * Unified Balance Kit handle for `/api/transfer/spend`.
 *
 * Constructs a singleton `UnifiedBalanceKit` instance + a Viem-backed
 * delegate adapter from `SENDERO_UB_DELEGATE_PRIVATE_KEY`. The route
 * uses this adapter as the signer for `kit.spend()`.
 *
 * Returns `null` when the env is missing so the route can return a
 * 503 with a clear "configure delegate" message instead of crashing.
 *
 *   The delegate model is the App Kit pattern from
 *   https://developers.circle.com/app-kit/quickstarts/unified-balance-delegate-deposit-and-spend.
 *   In production this should resolve from a KMS-backed secret;
 *   stashing a private key in an env var is fine for hackathon /
 *   testnet dev.
 */

import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';
import { UnifiedBalanceKit } from '@circle-fin/unified-balance-kit';

import { env } from '@sendero/env';

let cached: {
  kit: UnifiedBalanceKit;
  adapter: ReturnType<typeof createViemAdapterFromPrivateKey>;
} | null = null;

export function getUnifiedBalanceDelegate(): {
  kit: UnifiedBalanceKit;
  adapter: ReturnType<typeof createViemAdapterFromPrivateKey>;
} | null {
  if (cached) return cached;
  const key = env.unifiedBalanceDelegateKey();
  if (!key) return null;
  const normalized = key.startsWith('0x') ? key : `0x${key}`;
  const adapter = createViemAdapterFromPrivateKey({
    privateKey: normalized as `0x${string}`,
  });
  const kit = new UnifiedBalanceKit();
  cached = { kit, adapter };
  return cached;
}
