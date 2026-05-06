/**
 * get_sendero_identity — surface Sendero's own ERC-8004 agent identity.
 *
 * Sendero is the AI travel agent that all tenant agencies run on top of.
 * It has its own on-chain identity — an ERC-8004 agent NFT minted to a
 * Sendero-owned wallet — that travelers can rate after each completed
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
 * Returns Sendero's `SENDERO_AGENT_ID` (the ERC-8004 token id minted
 * to the platform agent), cached aggregations from the
 * `OnchainIdentity` row matching that agentId, and links to Arcscan /
 * the on-chain registry. Distinct from `get_operator_agency`, which
 * surfaces the TENANT-level identity (the customer-facing brand).
 *
 * Public read-only — no traveler-side mutation. Safe across channels.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const inputSchema = z.object({});

export type GetSenderoIdentityInput = z.infer<typeof inputSchema>;

export interface SenderoIdentityResult {
  status: 'ok' | 'unconfigured' | 'unminted';
  message?: string;
  /** ERC-8004 agent id (decimal uint256) for Sendero's own agent NFT. */
  agentId: string;
  /** What Sendero IS — capability summary the agent can quote verbatim. */
  capabilities: readonly string[];
  /** Documentation / public surface URLs the agent can share. */
  links: {
    docs: string;
    api: string;
    /** Block-explorer link to the on-chain agent record (when minted). */
    registry?: string;
  };
  /** ERC-8004 cached aggregations — populated once travelers start rating. */
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
  'on-chain trip attestations + reputation (ERC-8004)',
] as const;

const ARCSCAN_BASE = process.env.ARC_EXPLORER_URL ?? 'https://testnet.arcscan.app';

export async function getSenderoIdentity(): Promise<SenderoIdentityResult> {
  const agentId = process.env.SENDERO_AGENT_TOKEN_ID ?? process.env.SENDERO_AGENT_ID ?? null;

  if (!agentId || agentId === '0') {
    return {
      status: 'unconfigured',
      message:
        'Sendero agent NFT id is not configured (SENDERO_AGENT_TOKEN_ID / SENDERO_AGENT_ID unset). Surface a placeholder identity without on-chain reputation.',
      agentId: '0',
      capabilities: SENDERO_CAPABILITIES,
      links: { docs: 'https://sendero.travel', api: 'https://sendero.travel/docs/api' },
    };
  }

  const onchain = await prisma.onchainIdentity.findFirst({
    where: { agentId },
    select: {
      agentId: true,
      holderAddress: true,
      contract: true,
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidatorCount: true,
      cachedValidationCount: true,
      cachedAt: true,
      status: true,
    },
  });

  const links: SenderoIdentityResult['links'] = {
    docs: 'https://sendero.travel',
    api: 'https://sendero.travel/docs/api',
  };
  if (onchain?.holderAddress) {
    links.registry = `${ARCSCAN_BASE}/address/${onchain.holderAddress}`;
  }

  if (!onchain) {
    return {
      status: 'unminted',
      message: `SENDERO_AGENT_ID=${agentId} is configured but no OnchainIdentity row matches it yet. Surface capabilities + docs links; skip reputation.`,
      agentId,
      capabilities: SENDERO_CAPABILITIES,
      links,
    };
  }

  return {
    status: 'ok',
    agentId,
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
    "Return Sendero's own ERC-8004 agent identity — the AI platform underneath every tenant agency. Use when the traveler asks specifically about Sendero, the AI, the platform's reputation, or the on-chain agent registry. Returns Sendero's agent NFT id, capability summary, docs/api links, registry block-explorer link, and cached on-chain reputation (avg stars, feedback count, validator count). For agency-brand questions (who is operating this WhatsApp number, what travel agency is this), use `get_operator_agency` instead.",
  inputSchema,
  jsonSchema: { type: 'object', properties: {} },
  handler: getSenderoIdentity,
};
