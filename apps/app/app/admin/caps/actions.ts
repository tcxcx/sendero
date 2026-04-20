'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@sendero/database';
import type { CapPeriod } from '@sendero/database';

export interface UpsertCapInput {
  tenantId: string;
  period: CapPeriod;
  /** Decimal USDC string — server converts to micro. */
  amountUsdc: string;
  hardCap: boolean;
  alertWebhookUrl?: string | null;
}

function toMicroUsdc(decimal: string): bigint {
  const [whole, frac = ''] = decimal.trim().split('.');
  const padded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

export async function upsertCap(
  input: UpsertCapInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d+(\.\d{1,6})?$/.test(input.amountUsdc)) {
    return { ok: false, error: 'amountUsdc must be a decimal with up to 6 fractional digits' };
  }
  try {
    await prisma.tenantSpendCap.upsert({
      where: { tenantId_period: { tenantId: input.tenantId, period: input.period } },
      create: {
        tenantId: input.tenantId,
        period: input.period,
        amountMicroUsdc: toMicroUsdc(input.amountUsdc),
        hardCap: input.hardCap,
        alertWebhookUrl: input.alertWebhookUrl ?? null,
      },
      update: {
        amountMicroUsdc: toMicroUsdc(input.amountUsdc),
        hardCap: input.hardCap,
        alertWebhookUrl: input.alertWebhookUrl ?? null,
      },
    });
    revalidatePath('/admin/caps');
    revalidatePath('/admin/spend');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteCap(args: { tenantId: string; period: CapPeriod }): Promise<void> {
  await prisma.tenantSpendCap.delete({
    where: { tenantId_period: { tenantId: args.tenantId, period: args.period } },
  });
  revalidatePath('/admin/caps');
}
