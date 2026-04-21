'use server';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const optionalText = z
  .string()
  .trim()
  .transform(value => (value.length ? value : null));

const BillingFormSchema = z.object({
  legalName: optionalText,
  billingContactEmail: z
    .string()
    .trim()
    .transform(value => (value.length ? value : null))
    .pipe(z.string().email().nullable()),
  taxId: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  region: optionalText,
  postalCode: optionalText,
  country: optionalText,
});

const BrandingFormSchema = z.object({
  brandLogoUrl: optionalText,
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  primaryHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

async function requireAdminOrg() {
  const { orgId, has } = await auth();
  if (!orgId) return { error: 'no_org' as const };
  if (!has({ role: 'org:admin' })) return { error: 'forbidden' as const };
  return { orgId };
}

export async function updateTenantBillingAction(formData: FormData): Promise<void> {
  const access = await requireAdminOrg();
  if ('error' in access) return;

  const parsed = BillingFormSchema.safeParse(formObject(formData));
  if (!parsed.success) return;

  const billingAddress = {
    line1: parsed.data.addressLine1,
    line2: parsed.data.addressLine2,
    city: parsed.data.city,
    region: parsed.data.region,
    postalCode: parsed.data.postalCode,
    country: parsed.data.country,
  };

  const tenant = await prisma.tenant.update({
    where: { clerkOrgId: access.orgId },
    data: {
      legalName: parsed.data.legalName,
      billingContactEmail: parsed.data.billingContactEmail,
      taxId: parsed.data.taxId,
      fiscalCountry: parsed.data.country,
      billingAddress,
    },
  });

  const client = await clerkClient();
  await client.organizations.updateOrganization(access.orgId, {
    publicMetadata: {
      legalName: tenant.legalName,
      taxId: tenant.taxId,
    },
  });

  revalidatePath('/app/settings/billing');
}

export async function updateTenantBrandingAction(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdminOrg();
  if ('error' in access) return { ok: false, error: access.error };

  const parsed = BrandingFormSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: 'Invalid brand colors.' };

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: access.orgId },
    select: { billingTier: true },
  });
  if (!tenant || !['business', 'enterprise'].includes(tenant.billingTier)) {
    return { ok: false, error: 'Branding requires a business or enterprise tenant.' };
  }

  await prisma.tenant.update({
    where: { clerkOrgId: access.orgId },
    data: {
      brandLogoUrl: parsed.data.brandLogoUrl,
      brandColors: {
        primary: parsed.data.primaryHex ?? parsed.data.primary,
        accent: parsed.data.accentHex ?? parsed.data.accent,
        background: parsed.data.backgroundHex ?? parsed.data.background,
      },
    },
  });
  await prisma.invoice.updateMany({
    where: { tenant: { clerkOrgId: access.orgId } },
    data: {
      pdfBlobUrl: null,
      pdfRenderedAt: null,
    },
  });

  revalidatePath('/app/settings/branding');
  revalidatePath('/app/billing/invoices');
  return { ok: true };
}
