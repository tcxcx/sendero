/**
 * get_operator_agency — surface the tenant agency identity that
 * operates this Sendero deployment.
 *
 * Sendero is the AI/agent platform; tenants are the customer-facing
 * travel agencies that operate ON BEHALF OF travelers. When a
 * traveler asks "what travel agency is this?" / "qué agencia es
 * esta?" / "who is operating this WhatsApp number?", the agent must
 * answer with the TENANT brand — not "Sendero" — and may close with
 * "operada por Sendero" only as platform footer.
 *
 * Composes:
 *   - `Tenant.{displayName, legalName, slug, brandLogoUrl,
 *      brandColors, fiscalCountry, arcAddress, metadata}`
 *   - `OnchainIdentity` row for `kind='org', tenantId=ctx.tenantId`:
 *      cached ERC-8004 aggregations (cachedStars,
 *      cachedFeedbackCount, cachedValidatorCount). Sub-50ms read —
 *      Circle Event Monitor webhook keeps the cache warm.
 *
 * Public read-only — no traveler-side state mutation. Safe across
 * channels (web operator chat, WhatsApp, Slack, MCP).
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  /**
   * Override tenant resolution by slug. Operator dashboard / cross-
   * tenant ops use this; the default (omitted) reads
   * `ctx.traveler.tenantId` so cross-tenant leaks are impossible
   * from customer-facing channels.
   */
  tenantSlug: z.string().min(1).max(120).optional(),
});

export type GetOperatorAgencyInput = z.infer<typeof inputSchema>;

export interface OperatorAgencyResult {
  status: 'ok' | 'no_tenant' | 'tenant_not_found';
  message?: string;
  agency?: {
    displayName: string;
    legalName: string | null;
    slug: string;
    brandLogoUrl: string | null;
    brandColors: { primary?: string; secondary?: string } | null;
    fiscalCountry: string | null;
    /** On-chain treasury address (MSCA) — Arc Testnet for now. */
    arcAddress: string | null;
    /** Free-form branding extras: phone, websiteUrl, support email, etc. */
    metadata: Record<string, unknown> | null;
  };
  /** ERC-8004 reputation cache — populated only after the first feedback event lands. */
  reputation?: {
    /** Decimal uint256 token id from `IdentityRegistry`. */
    agentId: string | null;
    holderAddress: string;
    /** 0-5 star average. Null until first feedback. */
    avgStars: number | null;
    feedbackCount: number;
    validatorCount: number;
    validationCount: number;
    cachedAt: string | null;
    /** Provisioning state: 'pending' | 'minted' | 'failed'. */
    status: string;
  };
  /** Always 'sendero' — the platform footer the agent uses for transparency. */
  operatedBy: 'sendero';
}

export async function getOperatorAgency(
  input: GetOperatorAgencyInput,
  ctx?: ToolContext
): Promise<OperatorAgencyResult> {
  const tenantSlug = input.tenantSlug;
  const tenantId = ctx?.traveler?.tenantId;

  if (!tenantSlug && !tenantId) {
    return {
      status: 'no_tenant',
      message:
        'No tenant context. The operator dashboard or signed-in traveler must be attached to a tenant for this tool to resolve.',
      operatedBy: 'sendero',
    };
  }

  const where = tenantSlug ? { slug: tenantSlug } : { id: tenantId! };
  const tenant = await prisma.tenant.findUnique({
    where,
    select: {
      id: true,
      displayName: true,
      legalName: true,
      slug: true,
      brandLogoUrl: true,
      brandColors: true,
      fiscalCountry: true,
      arcAddress: true,
      metadata: true,
    },
  });

  if (!tenant) {
    return {
      status: 'tenant_not_found',
      message: tenantSlug
        ? `No tenant with slug '${tenantSlug}'.`
        : `Tenant id '${tenantId}' is bound but the row was deleted.`,
      operatedBy: 'sendero',
    };
  }

  const onchain = await prisma.onchainIdentity.findUnique({
    where: { kind_tenantId: { kind: 'org', tenantId: tenant.id } },
    select: {
      agentId: true,
      holderAddress: true,
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidatorCount: true,
      cachedValidationCount: true,
      cachedAt: true,
      status: true,
    },
  });

  return {
    status: 'ok',
    agency: {
      displayName: tenant.displayName,
      legalName: tenant.legalName,
      slug: tenant.slug,
      brandLogoUrl: tenant.brandLogoUrl,
      brandColors: (tenant.brandColors as { primary?: string; secondary?: string } | null) ?? null,
      fiscalCountry: tenant.fiscalCountry,
      arcAddress: tenant.arcAddress,
      metadata: (tenant.metadata as Record<string, unknown> | null) ?? null,
    },
    reputation: onchain
      ? {
          agentId: onchain.agentId,
          holderAddress: onchain.holderAddress,
          avgStars: onchain.cachedStars,
          feedbackCount: onchain.cachedFeedbackCount,
          validatorCount: onchain.cachedValidatorCount,
          validationCount: onchain.cachedValidationCount,
          cachedAt: onchain.cachedAt?.toISOString() ?? null,
          status: onchain.status,
        }
      : undefined,
    operatedBy: 'sendero',
  };
}

export const getOperatorAgencyTool: ToolDef<GetOperatorAgencyInput, OperatorAgencyResult> = {
  name: 'get_operator_agency',
  description:
    "Return the travel agency identity that OPERATES this WhatsApp / Slack / web instance. Sendero is the underlying AI platform; the tenant is the agency the traveler is actually doing business with. Call this when the traveler asks who you are, what agency this is, who they're booking through, or asks about the agency's on-chain reputation. Returns displayName + legalName + slug + brand assets + ERC-8004 reputation (avgStars + feedbackCount). Identify yourself as the AGENCY in the reply; mention 'operada por Sendero' only if specifically asked about the AI platform.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tenantSlug: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
        description:
          "Optional tenant slug override (operator-only). Defaults to the caller's bound tenant.",
      },
    },
  },
  handler: getOperatorAgency,
};
