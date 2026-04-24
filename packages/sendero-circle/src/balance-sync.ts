/**
 * Circle webhook → DB balance sync.
 *
 * Called from the Circle webhook handler whenever a transfer event
 * touches a wallet we know about. Pulls the full token balance list
 * from Circle, splits USDC + EURC amounts into micro-USDC, and
 * upserts the cached columns on CircleWallet. The UI reads from those
 * cached columns so we never poll viem against Arc from the browser.
 */

import { getCircle } from './wallets';

/**
 * Convert Circle's decimal amount string ("5" → 5 USDC, "5.25" →
 * 5.25 USDC) into *6-decimal* micro-USDC regardless of the token's
 * on-chain `decimals` field. Arc testnet USDC reports 18 decimals
 * but the amount string is already the human-readable value, so we
 * always normalize to 6 decimals for storage and display.
 */
export function toMicro(amount: string): bigint {
  if (!amount) return 0n;
  const trimmed = amount.trim();
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const body = trimmed.replace(/^[+-]/, '');
  const [whole = '0', frac = ''] = body.split('.');
  const padded = (frac + '000000').slice(0, 6);
  const w = BigInt(whole) * 1_000_000n;
  const f = BigInt(padded || '0');
  return sign * (w + f);
}

export interface WalletBalancesMicro {
  usdcMicro: bigint;
  eurcMicro: bigint;
  observedAt: Date;
}

/**
 * Fetch USDC + EURC balances for a Circle wallet and return them in
 * micro-unit form. Callers persist these on the cached columns.
 */
export async function fetchWalletBalances(circleWalletId: string): Promise<WalletBalancesMicro> {
  const circle = getCircle();
  const response = await circle.getWalletTokenBalance({
    id: circleWalletId,
    includeAll: true,
  } as { id: string; includeAll: boolean });
  const tokenBalances =
    ((response.data as unknown as { tokenBalances?: Array<Record<string, unknown>> })
      ?.tokenBalances as Array<Record<string, unknown>> | undefined) ?? [];

  let usdcMicro = 0n;
  let eurcMicro = 0n;
  for (const row of tokenBalances) {
    const token = row.token as { symbol?: string } | undefined;
    const symbol = (token?.symbol ?? '').toUpperCase();
    const amount = String(row.amount ?? '0');
    if (symbol === 'USDC') usdcMicro += toMicro(amount);
    else if (symbol === 'EURC') eurcMicro += toMicro(amount);
  }
  return { usdcMicro, eurcMicro, observedAt: new Date() };
}

/**
 * Thin DB-agnostic sync interface. Apps wire this against
 * `@sendero/database`'s CircleWallet model.
 */
export interface CircleWalletStore {
  updateByCircleId: (
    circleWalletId: string,
    patch: { usdcBalanceMicro: bigint; eurcBalanceMicro: bigint; balanceUpdatedAt: Date }
  ) => Promise<void>;
}

export async function syncWalletBalance(
  store: CircleWalletStore,
  circleWalletId: string
): Promise<WalletBalancesMicro> {
  const balances = await fetchWalletBalances(circleWalletId);
  await store.updateByCircleId(circleWalletId, {
    usdcBalanceMicro: balances.usdcMicro,
    eurcBalanceMicro: balances.eurcMicro,
    balanceUpdatedAt: balances.observedAt,
  });
  return balances;
}
