/**
 * get_sendero_identity — surface Sendero's own on-chain agent identity.
 *
 * Sendero is the AI travel agent that all tenant agencies run on top of.
 * It has its own on-chain identity minted to a Sendero-owned wallet
 * that travelers can rate after each completed
 * trip via `complete_trip` (which fires `give_feedback`). This tool
 * exposes Sendero's own reputation so the agent can answer questions
 * like:
 *
 *   - "What's Sendero?" / "What AI is this?" / "Quién es Sendero?"
 *   - "Show me Sendero's on-chain reputation" / "Cuántas estrellas
 *     tiene Sendero?"
 *   - "Where can I see your agent registry?" / "Mostrame tu identidad
 *     on-chain"
 *
 * Returns Sendero's `SENDERO_AGENT_ID` (the platform agent id minted
 * to the platform agent), cached aggregations from the
 * `OnchainIdentity` row matching that agentId and the caller tenant's
 * chain, plus links to the tenant's on-chain registry. Distinct from
 * `get_operator_agency`, which
 * surfaces the TENANT-level identity (the customer-facing brand).
 *
 * Public read-only — no traveler-side mutation. Safe across channels.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({});

export type GetSenderoIdentityInput = z.infer<typeof inputSchema>;
type Chain = 'arc' | 'sol';

export interface SenderoIdentityResult {
  status: 'ok' | 'unconfigured' | 'unminted';
  message?: string;
  /** Platform agent id for Sendero's own on-chain identity. */
  agentId: string;
  chain: Chain;
  registryName: string;
  explorerName: string;
  /** What Sendero IS — capability summary the agent can quote verbatim. */
  capabilities: readonly string[];
  /** Documentation / public surface URLs the agent can share. */
  links: {
    docs: string;
    api: string;
    /** Block-explorer link to the on-chain agent record (when minted). */
    registry?: string;
  };
  /** Cached aggregations — populated once travelers start rating. */
  reputation?: {
    holderAddress: string;
    avgStars: number | null;
    feedbackCount: number;
    validatorCount: number;
    validationCount: number;
    cachedAt: string | null;
    /** 'pending' | 'minted' | 'failed'. */
    status: string;
  };
}

const SENDERO_CAPABILITIES = [
  'flight search + booking (Duffel)',
  'hotel search + booking (Duffel Stays)',
  'eSIM provisioning (eSIM Go)',
  'USDC wallet + cross-chain transfers (Circle Gateway)',
  'pre-trip + in-trip concierge with grounded web research (Gemini)',
  'cross-channel handoff to human operators (WhatsApp / Slack / web)',
  "on-chain trip attestations + reputation in the tenant's identity registry",
] as const;

const ARCSCAN_BASE = process.env.ARC_EXPLORER_URL ?? 'https://testnet.arcscan.app';
const SOLANA_EXPLORER_BASE = 'https://explorer.solana.com';
const SOL_AGENT_REGISTRY_PROGRAM_ID = '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p';

async function resolveCallerChain(ctx?: ToolContext): Promise<Chain> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return 'arc';
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true },
  });
  return tenant?.primaryChain === 'sol' ? 'sol' : 'arc';
}

function registryMeta(chain: Chain, contract?: string | null) {
  if (chain === 'sol') {
    return {
      registryName: 'Metaplex Agent Registry',
      explorerName: 'Solana Explorer',
      registryUrl: `${SOLANA_EXPLORER_BASE}/address/${contract ?? SOL_AGENT_REGISTRY_PROGRAM_ID}?cluster=devnet`,
    };
  }
  return {
    registryName: 'ERC-8004 IdentityRegistry',
    explorerName: 'Arcscan',
    registryUrl: contract ? `${ARCSCAN_BASE}/address/${contract}` : undefined,
  };
}

export async function getSenderoIdentity(
  ctx?: ToolContext
): Promise<SenderoIdentityResult> {
  const chain = await resolveCallerChain(ctx);
  const agentId = process.env.SENDERO_AGENT_TOKEN_ID ?? process.env.SENDERO_AGENT_ID ?? null;
  const meta = registryMeta(chain);

  if (!agentId || agentId === '0') {
    return {
      status: 'unconfigured',
      message:
        'Sendero agent NFT id is not configured (SENDERO_AGENT_TOKEN_ID / SENDERO_AGENT_ID unset). Surface a placeholder identity without on-chain reputation.',
      agentId: '0',
      chain,
      registryName: meta.registryName,
      explorerName: meta.explorerName,
      capabilities: SENDERO_CAPABILITIES,
      links: {
        docs: 'https://sendero.travel',
        api: 'https://sendero.travel/docs/api',
        ...(meta.registryUrl ? { registry: meta.registryUrl } : {}),
      },
    };
  }

  const onchain = await prisma.onchainIdentity.findFirst({
    where: { agentId, chain },
    select: {
      agentId: true,
      holderAddress: true,
      contract: true,
      chain: true,
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidatorCount: true,
      cachedValidationCount: true,
      cachedAt: true,
      status: true,
    },
  });
  const resolvedMeta = registryMeta(chain, onchain?.contract);

  const links: SenderoIdentityResult['links'] = {
    docs: 'https://sendero.travel',
    api: 'https://sendero.travel/docs/api',
  };
  if (resolvedMeta.registryUrl) {
    links.registry = resolvedMeta.registryUrl;
  }

  if (!onchain) {
    return {
      status: 'unminted',
      message: `SENDERO_AGENT_ID=${agentId} is configured but no ${resolvedMeta.registryName} OnchainIdentity row matches it yet. Surface capabilities + docs links; skip reputation.`,
      agentId,
      chain,
      registryName: resolvedMeta.registryName,
      explorerName: resolvedMeta.explorerName,
      capabilities: SENDERO_CAPABILITIES,
      links,
    };
  }

  return {
    status: 'ok',
    agentId,
    chain,
    registryName: resolvedMeta.registryName,
    explorerName: resolvedMeta.explorerName,
    capabilities: SENDERO_CAPABILITIES,
    links,
    reputation: {
      holderAddress: onchain.holderAddress,
      avgStars: onchain.cachedStars,
      feedbackCount: onchain.cachedFeedbackCount,
      validatorCount: onchain.cachedValidatorCount,
      validationCount: onchain.cachedValidationCount,
      cachedAt: onchain.cachedAt?.toISOString() ?? null,
      status: onchain.status,
    },
  };
}

export const getSenderoIdentityTool: ToolDef<GetSenderoIdentityInput, SenderoIdentityResult> = {
  name: 'get_sendero_identity',
  description:
    "Return Sendero's own on-chain agent identity for the caller tenant's primary chain. Use when the traveler asks specifically about Sendero, the AI, the platform's reputation, or the on-chain agent registry. Returns Sendero's agent id, capability summary, docs/api links, the chain-aware registry block-explorer link, and cached reputation when available. For agency-brand questions (who is operating this WhatsApp number, what travel agency is this), use `get_operator_agency` instead.",
  inputSchema,
  jsonSchema: { type: 'object', properties: {} },
  handler: (_input, ctx) => getSenderoIdentity(ctx),
};
