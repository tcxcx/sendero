'use server';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { invoiceToTemplateProps, renderInvoicePdfBuffer } from '@sendero/invoicing';
import { provisionTenantWallet } from '@sendero/circle';
import { retrySettlingBatches, type BatchStore, type SettleFn } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';
import { transferUSDC } from '@sendero/nanopayments';
import { revalidatePath } from 'next/cache';
import type { Address } from 'viem';

type RetryResult = { ok: true; message: string } | { ok: false; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function requireAdminTenant(): Promise<
  { ok: true; tenantId: string; orgId: string } | { ok: false; message: string }
> {
  const { orgId, has } = await auth();
  if (!orgId) return { ok: false, message: 'No active organization.' };
  if (!has({ role: 'org:admin' })) return { ok: false, message: 'Admin role required.' };

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return { ok: false, message: 'Tenant not found.' };

  return { ok: true, tenantId: tenant.id, orgId };
}

export async function retryInvoicePdfAction(invoiceId: string): Promise<RetryResult> {
  const access = await requireAdminTenant();
  if (access.ok === false) return { ok: false, message: access.message };

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: access.tenantId },
      include: {
        lineItems: { orderBy: { position: 'asc' } },
        tenant: { select: { brandLogoUrl: true, brandColors: true } },
      },
    });
    if (!invoice) return { ok: false, message: 'Invoice not found.' };

    const props = invoiceToTemplateProps({
      invoice,
      tenant: invoice.tenant,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
    const buf = await renderInvoicePdfBuffer(props);
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (!blobToken) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          pdfBlobUrl: null,
          pdfRenderedAt: new Date(),
        },
      });
      revalidatePath(`/app/billing/invoices/${invoice.id}`);
      return {
        ok: true,
        message: 'PDF rendered. Blob token is missing, so no cached PDF URL was saved.',
      };
    }

    const { url: pdfBlobUrl } = await put(`invoices/${invoice.tenantId}/${invoice.id}.pdf`, buf, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/pdf',
      token: blobToken,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfBlobUrl, pdfRenderedAt: new Date() },
    });
    revalidatePath('/app/billing/invoices');
    revalidatePath(`/app/billing/invoices/${invoice.id}`);

    return { ok: true, message: 'Invoice PDF re-rendered and cached.' };
  } catch (err) {
    return { ok: false, message: `Invoice retry failed: ${errorMessage(err)}` };
  }
}

export async function retryFailedBatchesAction(): Promise<RetryResult> {
  const access = await requireAdminTenant();
  if (access.ok === false) return { ok: false, message: access.message };

  try {
    const reset = await prisma.nanopayBatch.updateMany({
      where: { tenantId: access.tenantId, status: 'failed' },
      data: {
        status: 'settling',
        retryCount: 0,
        error: null,
        lastError: null,
      },
    });

    const results = await retrySettlingBatches(
      makeTenantBatchStore(access.tenantId),
      makeSettleFn(),
      { olderThanMs: 0, limit: 20 }
    );
    revalidatePath('/app/spend');

    const settled = results.filter(result => result.status === 'settled').length;
    const failed = results.filter(result => result.status === 'failed').length;
    const retrying = results.filter(result => result.status === 'retrying').length;
    return {
      ok: failed === 0,
      message: `Reset ${reset.count} failed batch(es). Retried ${results.length}: ${settled} settled, ${retrying} retrying, ${failed} failed.`,
    };
  } catch (err) {
    return { ok: false, message: `Batch retry failed: ${errorMessage(err)}` };
  }
}

export async function retryWalletProvisionAction(): Promise<RetryResult> {
  const access = await requireAdminTenant();
  if (access.ok === false) return { ok: false, message: access.message };

  try {
    const result = await provisionTenantWallet({
      tenantId: access.tenantId,
      clerkOrgId: access.orgId,
    });
    const client = await clerkClient();
    await client.organizations.updateOrganization(access.orgId, {
      publicMetadata: {
        tenantId: access.tenantId,
        arcWalletAddress: result.address,
        onboardingComplete: true,
      },
    });

    revalidatePath('/app/settings/org');
    return {
      ok: true,
      message: result.alreadyExisted
        ? 'Wallet already exists; Clerk metadata refreshed.'
        : 'Wallet provisioned and Clerk metadata refreshed.',
    };
  } catch (err) {
    return { ok: false, message: `Wallet retry failed: ${errorMessage(err)}` };
  }
}

function makeTenantBatchStore(tenantId: string): BatchStore {
  return {
    findClaimableEvents: async ({ windowEndedAt, limit }) =>
      prisma.meterEvent.findMany({
        where: {
          tenantId,
          status: 'paid',
          settlementRef: null,
          at: { lte: windowEndedAt },
        },
        select: { id: true, priceMicroUsdc: true },
        orderBy: { at: 'asc' },
        take: limit,
      }),

    openBatch: async args => {
      const row = await prisma.nanopayBatch.create({
        data: {
          tenantId,
          status: 'pending',
          totalMicroUsdc: args.totalMicroUsdc,
          eventCount: args.eventCount,
          windowStartedAt: args.windowStartedAt,
          windowEndedAt: args.windowEndedAt,
        },
        select: { id: true },
      });
      return { id: row.id };
    },

    claimEventsForBatch: async ({ batchId, eventIds }) => {
      await prisma.meterEvent.updateMany({
        where: { tenantId, id: { in: eventIds } },
        data: { settlementRef: batchId },
      });
    },

    updateBatchStatus: async args => {
      await prisma.nanopayBatch.update({
        where: { id: args.batchId },
        data: {
          status: args.status,
          txHash: args.txHash ?? undefined,
          error: args.error ?? undefined,
          settledAt: args.settledAt ?? undefined,
        },
      });
    },

    incrementRetry: async ({ batchId, lastError }) => {
      const row = await prisma.nanopayBatch.update({
        where: { id: batchId },
        data: {
          retryCount: { increment: 1 },
          lastError,
        },
        select: { retryCount: true },
      });
      return { retryCount: row.retryCount };
    },

    findSettlingBatches: async ({ olderThan, limit, maxRetryCount }) =>
      prisma.nanopayBatch.findMany({
        where: {
          tenantId,
          status: 'settling',
          updatedAt: { lte: olderThan },
          retryCount: { lt: maxRetryCount },
        },
        select: { id: true, tenantId: true, totalMicroUsdc: true, retryCount: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      }),
  };
}

function senderoTreasuryAddress(): Address {
  const address = process.env.SENDERO_TREASURY_ADDRESS;
  if (!address) throw new Error('SENDERO_TREASURY_ADDRESS not configured');
  return address as Address;
}

function makeSettleFn(): SettleFn {
  const to = senderoTreasuryAddress();
  return async ({ totalMicroUsdc, batchId, tenantId }) => {
    const amount = (Number(totalMicroUsdc) / 1e6).toFixed(6);
    const { txHash } = await transferUSDC({
      to,
      amount,
      label: `nanopay-batch:${tenantId}:${batchId}`,
    });
    return { txHash };
  };
}
