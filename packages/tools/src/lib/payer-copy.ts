import type { MeterPayerType } from '@sendero/database';

/**
 * Single source of truth for payer-aware copy across all four channel
 * renderers (operator, slack, whatsapp, web). Tools build these strings
 * once and pass them through the canonical channel-render layer.
 *
 * Two slots:
 *   - `lineItem`  — short price + payer attribution. Goes on cards,
 *                   confirmations, receipts. e.g. "$1,820 · on Sendero
 *                   Travel" or "$1,820 · charged to your wallet".
 *   - `footnote`  — longer attribution sentence for footers / fine
 *                   print. e.g. "This trip is on Sendero Travel — your
 *                   employer's company travel program."
 */

export interface PayerCopyArgs {
  payer: MeterPayerType;
  /** Display amount with currency, e.g. `"$1,820"`. */
  amount: string;
  /** Tenant display name — required for tenant-paid copy. */
  tenantName?: string | null;
}

export interface PayerCopy {
  lineItem: string;
  footnote: string;
}

export function payerCopy(args: PayerCopyArgs): PayerCopy {
  const { payer, amount, tenantName } = args;
  if (payer === 'tenant') {
    const name = tenantName?.trim() || 'your travel program';
    return {
      lineItem: `${amount} · on ${name}`,
      footnote: `This charge is covered by ${name} — no out-of-pocket cost to you.`,
    };
  }
  return {
    lineItem: `${amount} · charged to your wallet`,
    footnote: `Charged from your Sendero wallet (USDC). Top up anytime from your Sendero account.`,
  };
}
