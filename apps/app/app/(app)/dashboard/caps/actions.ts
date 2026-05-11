'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma, type CapPeriod } from '@sendero/database';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

function toMicroUsdc(decimal: string): bigint {
  const [whole, frac = ''] = decimal.trim().split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

async function requireAdminTenantId() {
  const { orgId, has } = await auth();
  if (!orgId) redirect('/onboarding');
  if (!has({ role: 'org:admin' })) redirect('/dashboard');
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) redirect('/onboarding');
  return tenant.id;
}

export async function upsertCapAction(formData: FormData) {
  const tenantId = await requireAdminTenantId();
  const amountUsdc = String(formData.get('amountUsdc') ?? '0');
  if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) return;
  const period = String(formData.get('period') ?? 'daily') as CapPeriod;
  await prisma.tenantSpendCap.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: {
      tenantId,
      period,
      amountMicroUsdc: toMicroUsdc(amountUsdc),
      hardCap: formData.get('hardCap') === 'on',
      alertWebhookUrl: String(formData.get('alertWebhookUrl') ?? '') || null,
    },
    update: {
      amountMicroUsdc: toMicroUsdc(amountUsdc),
      hardCap: formData.get('hardCap') === 'on',
      alertWebhookUrl: String(formData.get('alertWebhookUrl') ?? '') || null,
    },
  });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/spend');
}

export async function deleteCapAction(formData: FormData) {
  const tenantId = await requireAdminTenantId();
  const period = String(formData.get('period') ?? 'daily') as CapPeriod;
  await prisma.tenantSpendCap.delete({ where: { tenantId_period: { tenantId, period } } });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/spend');
}
