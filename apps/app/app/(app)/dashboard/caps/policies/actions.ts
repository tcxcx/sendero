'use server';

/**
 * TransferPolicy server actions.
 *
 * Admin role gate on every mutation.  Form fields are validated then
 * mapped to a `config` JSON shape that the runtime parser
 * (apps/app/lib/transfer-policy/parse.ts::buildGuardFromRow) accepts.
 *
 * Bad input is rejected at the action layer rather than persisted-and-
 * skipped-at-load, so the editor surfaces validation errors instead of
 * silently writing rows the runtime will warn-and-drop.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { prisma, type Prisma } from '@sendero/database';

type GuardKind = 'budget' | 'single_tx' | 'recipient' | 'rate_limit' | 'confirm';
type Scope = 'tenant' | 'traveler' | 'tool';

async function requireAdminTenantId(): Promise<string> {
  const { orgId, has } = await auth();
  if (!orgId) redirect('/onboarding/choose-org');
  if (!has({ role: 'org:admin' })) redirect('/dashboard');
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) redirect('/onboarding');
  return tenant.id;
}

function toMicro(decimal: string): bigint | null {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

function buildConfig(kind: GuardKind, formData: FormData): Record<string, unknown> | string {
  switch (kind) {
    case 'budget': {
      const period = String(formData.get('period') ?? '');
      if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
        return 'Period must be daily, weekly, or monthly.';
      }
      const cap = toMicro(String(formData.get('capUsdc') ?? ''));
      if (cap === null) return 'Cap must be a number with up to 6 decimals.';
      return { period, capMicroUsdc: cap.toString() };
    }
    case 'single_tx': {
      const max = toMicro(String(formData.get('maxUsdc') ?? ''));
      if (max === null) return 'Max must be a number with up to 6 decimals.';
      return { maxMicroUsdc: max.toString() };
    }
    case 'recipient': {
      const mode = String(formData.get('mode') ?? '');
      if (mode !== 'allow' && mode !== 'deny') return 'Mode must be allow or deny.';
      const raw = String(formData.get('addresses') ?? '');
      const addresses = raw
        .split(/[\n,;]+/)
        .map(a => a.trim())
        .filter(Boolean);
      if (addresses.length === 0) return 'At least one address is required.';
      return { mode, addresses };
    }
    case 'rate_limit': {
      const maxCount = Number(formData.get('maxCount') ?? '0');
      const windowMs = Number(formData.get('windowMs') ?? '0');
      if (!Number.isFinite(maxCount) || maxCount < 1) return 'Max count must be ≥ 1.';
      if (!Number.isFinite(windowMs) || windowMs < 1) return 'Window must be ≥ 1ms.';
      return { maxCount: Math.trunc(maxCount), windowMs: Math.trunc(windowMs) };
    }
    case 'confirm': {
      const triggerInput = String(formData.get('triggerUsdc') ?? '').trim();
      const reason = String(formData.get('reason') ?? '').trim();
      const config: Record<string, unknown> = {};
      if (triggerInput) {
        const trigger = toMicro(triggerInput);
        if (trigger === null) return 'Trigger must be a number with up to 6 decimals.';
        config.triggerAtMicroUsdc = trigger.toString();
      }
      if (reason) config.reason = reason;
      return config;
    }
    default:
      return 'Unknown guard kind.';
  }
}

function readScope(
  formData: FormData
): { scope: Scope; travelerId: string | null; toolName: string | null } | string {
  const scope = String(formData.get('scope') ?? '');
  if (scope !== 'tenant' && scope !== 'traveler' && scope !== 'tool') {
    return 'Scope must be tenant, traveler, or tool.';
  }
  if (scope === 'traveler') {
    const travelerId = String(formData.get('travelerId') ?? '').trim();
    if (!travelerId) return 'Pick a traveler.';
    return { scope, travelerId, toolName: null };
  }
  if (scope === 'tool') {
    const toolName = String(formData.get('toolName') ?? '').trim();
    if (!toolName) return 'Tool name is required.';
    return { scope, travelerId: null, toolName };
  }
  return { scope, travelerId: null, toolName: null };
}

export async function createTransferPolicy(formData: FormData): Promise<void> {
  const tenantId = await requireAdminTenantId();
  const scopeResult = readScope(formData);
  if (typeof scopeResult === 'string') {
    redirect(`/dashboard/caps/policies/new?error=${encodeURIComponent(scopeResult)}`);
  }
  const { scope, travelerId, toolName } = scopeResult as Exclude<typeof scopeResult, string>;
  const guardKind = String(formData.get('guardKind') ?? '') as GuardKind;
  if (!['budget', 'single_tx', 'recipient', 'rate_limit', 'confirm'].includes(guardKind)) {
    redirect(`/dashboard/caps/policies/new?error=${encodeURIComponent('Pick a guard kind.')}`);
  }
  const configResult = buildConfig(guardKind, formData);
  if (typeof configResult === 'string') {
    redirect(`/dashboard/caps/policies/new?error=${encodeURIComponent(configResult)}`);
  }
  await prisma.transferPolicy.create({
    data: {
      tenantId,
      scope,
      travelerId,
      toolName,
      guardKind,
      config: configResult as Prisma.InputJsonValue,
      hardCap: formData.get('hardCap') === 'on',
      alertWebhookUrl: String(formData.get('alertWebhookUrl') ?? '').trim() || null,
      enabled: formData.get('enabled') !== 'off',
      priority: parsePriority(formData.get('priority')),
    },
  });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/caps/policies');
  redirect('/dashboard/caps/policies');
}

export async function updateTransferPolicy(formData: FormData): Promise<void> {
  const tenantId = await requireAdminTenantId();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/dashboard/caps/policies');
  const scopeResult = readScope(formData);
  if (typeof scopeResult === 'string') {
    redirect(`/dashboard/caps/policies/${id}?error=${encodeURIComponent(scopeResult)}`);
  }
  const { scope, travelerId, toolName } = scopeResult as Exclude<typeof scopeResult, string>;
  const guardKind = String(formData.get('guardKind') ?? '') as GuardKind;
  const configResult = buildConfig(guardKind, formData);
  if (typeof configResult === 'string') {
    redirect(`/dashboard/caps/policies/${id}?error=${encodeURIComponent(configResult)}`);
  }
  await prisma.transferPolicy.updateMany({
    where: { id, tenantId },
    data: {
      scope,
      travelerId,
      toolName,
      guardKind,
      config: configResult as Prisma.InputJsonValue,
      hardCap: formData.get('hardCap') === 'on',
      alertWebhookUrl: String(formData.get('alertWebhookUrl') ?? '').trim() || null,
      enabled: formData.get('enabled') !== 'off',
      priority: parsePriority(formData.get('priority')),
    },
  });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/caps/policies');
  redirect('/dashboard/caps/policies');
}

export async function deleteTransferPolicy(formData: FormData): Promise<void> {
  const tenantId = await requireAdminTenantId();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  await prisma.transferPolicy.deleteMany({ where: { id, tenantId } });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/caps/policies');
}

export async function toggleTransferPolicy(formData: FormData): Promise<void> {
  const tenantId = await requireAdminTenantId();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  const row = await prisma.transferPolicy.findFirst({
    where: { id, tenantId },
    select: { enabled: true },
  });
  if (!row) return;
  await prisma.transferPolicy.updateMany({
    where: { id, tenantId },
    data: { enabled: !row.enabled },
  });
  revalidatePath('/dashboard/caps');
  revalidatePath('/dashboard/caps/policies');
}

function parsePriority(value: FormDataEntryValue | null): number {
  const n = Number(value ?? '100');
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(1000, Math.trunc(n)));
}
