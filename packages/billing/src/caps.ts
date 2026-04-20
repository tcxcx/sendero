/**
 * Per-tenant spend cap enforcement.
 *
 * Before charging a nanopayment, the consuming route asks
 * `evaluateCap({ tenantId, proposedMicroUsdc })`. If the tenant has a
 * hard cap for the active period and the cumulative spend + proposed
 * charge exceeds it, the call is rejected with `blocked: true`. Soft
 * caps log a warning and fire the tenant's alert webhook but let the
 * call through.
 */

import type { CapPeriod } from '@sendero/database';

export interface SpendCapSnapshot {
  tenantId: string;
  period: CapPeriod;
  /** Cap amount in micro-USDC. */
  amountMicroUsdc: bigint;
  hardCap: boolean;
  alertWebhookUrl?: string | null;
}

export interface CapStore {
  listForTenant: (tenantId: string) => Promise<SpendCapSnapshot[]>;
  /** Sum of MeterEvent.priceMicroUsdc in [windowStart, now()] with status='paid'. */
  spentInWindow: (args: { tenantId: string; windowStartedAt: Date }) => Promise<bigint>;
}

export interface CapEvaluation {
  blocked: boolean;
  warnings: string[];
  /** Detailed breakdown for dashboards / response headers. */
  periods: Array<{
    period: CapPeriod;
    spentMicro: bigint;
    capMicro: bigint;
    remainingMicro: bigint;
    hardCap: boolean;
  }>;
}

export function startOfDailyWindow(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function startOfMonthlyWindow(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function evaluateCap(
  store: CapStore,
  args: { tenantId: string; proposedMicroUsdc: bigint; now?: Date }
): Promise<CapEvaluation> {
  const now = args.now ?? new Date();
  const caps = await store.listForTenant(args.tenantId);
  const periods: CapEvaluation['periods'] = [];
  const warnings: string[] = [];
  let blocked = false;

  for (const cap of caps) {
    const windowStart =
      cap.period === 'daily' ? startOfDailyWindow(now) : startOfMonthlyWindow(now);
    const spent = await store.spentInWindow({
      tenantId: args.tenantId,
      windowStartedAt: windowStart,
    });
    const afterCharge = spent + args.proposedMicroUsdc;
    const remaining = cap.amountMicroUsdc - afterCharge;

    periods.push({
      period: cap.period,
      spentMicro: spent,
      capMicro: cap.amountMicroUsdc,
      remainingMicro: remaining,
      hardCap: cap.hardCap,
    });

    if (afterCharge > cap.amountMicroUsdc) {
      if (cap.hardCap) {
        blocked = true;
        warnings.push(
          `Hard ${cap.period} cap exceeded for tenant ${args.tenantId} (${afterCharge} > ${cap.amountMicroUsdc}).`
        );
      } else {
        warnings.push(`Soft ${cap.period} cap exceeded for tenant ${args.tenantId} — alert fired.`);
        if (cap.alertWebhookUrl) {
          void fireAlert(cap.alertWebhookUrl, {
            tenantId: args.tenantId,
            period: cap.period,
            afterCharge: afterCharge.toString(),
            cap: cap.amountMicroUsdc.toString(),
          });
        }
      }
    }
  }

  return { blocked, warnings, periods };
}

async function fireAlert(url: string, body: Record<string, string>): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort — do not block meter on alert delivery */
  }
}
