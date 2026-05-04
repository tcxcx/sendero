import { z } from 'zod';
import { queryUnifiedBalance } from '@sendero/circle/gateway';
import { getUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';
import type { ToolContext, ToolDef } from './types';

/** Sendero stores Solana DCWs with this synthetic chainId (Circle Gateway's Solana domain id). */
const SOL_DEVNET_CHAIN_ID = 5;
/** Arc Testnet chain id used by `ensureTravelerWallet` for the EVM DCW row. */
const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * `treasury_balance` — operator-only Gateway unified balance for the
 * platform treasury depositor (the long-running EOA that funds demos
 * and seeds liquidity). Always uses `TREASURY_PRIVATE_KEY`'s address
 * via `queryUnifiedBalance()` with no override.
 *
 * Distinct from `traveler_balance`. Customer-facing channels (WhatsApp,
 * Slack travelers) MUST NOT call this — it leaks treasury state. The
 * Kapso agent persona keeps this tool out of its enum.
 */
export const treasuryBalanceTool: ToolDef = {
  name: 'treasury_balance',
  description:
    'Operator-only. Return the Sendero TREASURY USDC unified balance across every Gateway-supported testnet (Arc, Ethereum Sepolia, Base Sepolia, Avalanche Fuji, etc.). Uses the platform treasury depositor — never the traveler. Use `traveler_balance` for personal balance questions.',
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  internal: true,
  async handler() {
    return queryUnifiedBalance();
  },
};

/**
 * `traveler_balance` — read the signed-in traveler's Circle Gateway
 * unified USDC balance. Resolves the depositor address from the user's
 * `UserGatewaySigner` row (same EOA pattern as the per-tenant Gateway
 * signer; see `ensureTravelerWallet`).
 *
 * Returns the same `{ total, balances }` shape as `treasury_balance`
 * so the agent can use it interchangeably from a rendering standpoint.
 *
 * Failure modes:
 *   - No `ctx.traveler.userId` → return a friendly "sign in first"
 *     payload so the agent can route the user to the auth flow rather
 *     than throwing.
 *   - Signer row not yet provisioned (race with first inbound) → same
 *     friendly response; the resolver provisions on next inbound.
 *   - Gateway API 5xx → bubble; agent relays the error verbatim per
 *     persona contract.
 */
export const travelerBalanceTool: ToolDef = {
  name: 'traveler_balance',
  description:
    "Return the SIGNED-IN TRAVELER's USDC unified balance across every Gateway-supported testnet. Resolves their Gateway depositor address from their Sendero user record. Use this for any question about the user's own wallet balance. Returns `{ total, balances }` or `{ status: 'no_wallet', message }` when the traveler hasn't been provisioned yet.",
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  async handler(_input: unknown, ctx?: ToolContext) {
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No signed-in traveler on this turn. Pass `travelerPhone` on `call_sendero` so Sendero can resolve the wallet, or ask the traveler to sign in first.',
      };
    }
    // Architecture flip (2026-05-04): the EVM Gateway depositor is now
    // the traveler's Circle DCW EVM address (chainId 5042002, Arc),
    // not the locally-generated UserGatewaySigner EOA. Reasons:
    //   - Circle DCW addresses are tracked by Circle's webhook system,
    //     so transactions.inbound fires on direct deposits and we can
    //     auto-deposit into Gateway via /api/webhooks/circle.
    //   - UserGatewaySigner EOAs are off Circle's radar — funds sent
    //     there strand silently (no webhook, no auto-deposit).
    // UserGatewaySigner stays the depositor of record on outbound burns
    // / EIP-712 transfer signatures (chainId-bound EIP-712 domain
    // pitfall on Circle DCW, see gateway-signer.ts header comment).
    // For balance reads, the DCW is the source of truth.
    const [evmDcw, solanaWallet, signer] = await Promise.all([
      prisma.wallet.findFirst({
        where: { userId, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
        select: { address: true },
      }),
      prisma.wallet.findFirst({
        where: { userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
        select: { address: true },
      }),
      // Legacy lookup — log the signer-EOA balance separately so we can
      // detect stranded funds and surface a "claim pending deposit" path.
      getUserGatewaySigner(userId, {
        caller: { surface: 'tool', userId, context: 'traveler_balance' },
      }),
    ]);
    if (!evmDcw && !solanaWallet) {
      return {
        status: 'no_wallet',
        message:
          'Wallet provisioning is still in progress. Try again in a few seconds — the next inbound will provision the Gateway depositor.',
      };
    }
    const balance = await queryUnifiedBalance({
      evm: (evmDcw?.address as Address | undefined),
      solana: solanaWallet?.address ?? undefined,
    });
    // Surface the EVM + Solana addresses on the response so the agent
    // can render the wallet card body without a separate Wallet lookup.
    // `signerAddress` is included for the structural-fix follow-up that
    // detects funds stranded on the legacy depositor address.
    return {
      ...balance,
      evmAddress: evmDcw?.address ?? null,
      solanaAddress: solanaWallet?.address ?? null,
      signerAddress: signer?.address ?? null,
    };
  },
};

/**
 * @deprecated Kept as an alias of `treasury_balance` so legacy callers
 * (older Kapso graph versions, MCP clients pinned to v0) keep working
 * during the rollout. Will be removed once the Kapso graph + docs flip
 * to the split tools.
 */
export const gatewayBalanceTool: ToolDef = {
  ...treasuryBalanceTool,
  name: 'gateway_balance',
  description:
    '[Deprecated alias of `treasury_balance`] Return the Sendero treasury USDC unified balance across every Gateway-supported testnet. Use `traveler_balance` for the SIGNED-IN TRAVELER instead.',
};
