import { z } from 'zod';
import { auditEvmAddresses, GATEWAY_CHAINS, type GatewayChainKey } from '@sendero/circle';
import { queryUnifiedBalance } from '@sendero/circle/gateway';
import { getUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';
import type { ToolContext, ToolDef } from './types';

/**
 * Map a `Wallet.chainId` (the integer column we stamp DCW rows with —
 * Arc Testnet = 5042002, Sol Devnet = 5, etc.) back to a Sendero
 * `GATEWAY_CHAINS` key so we can audit divergence with human-readable
 * chain labels. Returns `null` when the chainId isn't in the Gateway
 * map (e.g. legacy chains, MSCA-only entries).
 */
function chainIdToGatewayKey(chainId: number): GatewayChainKey | null {
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.kind === 'evm' && chain.viemChain.id === chainId) {
      return key as GatewayChainKey;
    }
  }
  return null;
}

/**
 * Sendero stores Solana DCWs with this synthetic chainId (Circle Gateway's
 * Solana domain id). Used to disambiguate the EVM DCW lookup below.
 */
const SOL_DEVNET_CHAIN_ID = 5;

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
    // Self-healing pre-sweep: Circle's transactions.inbound webhook is
    // the primary trigger but mis-routed webhook URLs, ngrok flapping,
    // and direct (non-Circle) transfers all leave funds stranded at
    // the DCW. Run a balance-check + sweep cycle on every traveler
    // balance read so the unified pool reflects truth without
    // depending on the webhook ever firing. Fail-soft: a sweep failure
    // doesn't block the read.
    const tenantIdForSweep = ctx?.traveler?.tenantId;
    if (tenantIdForSweep) {
      try {
        const { autoSweepStrandedTravelerBalances } = await import(
          '@sendero/circle/auto-sweep-traveler'
        );
        const sweepResult = await autoSweepStrandedTravelerBalances({
          userId,
          tenantId: tenantIdForSweep,
        });
        if (sweepResult.swept.length > 0) {
          console.log('[traveler_balance] auto-swept stranded balances', {
            userId,
            swept: sweepResult.swept.map(s => ({ chain: s.chainKey, amount: s.amount })),
          });
        }
      } catch (err) {
        console.warn('[traveler_balance] auto-sweep failed (non-fatal)', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // DRY balance lookup — same shared helper book_flight and
    // notifyTravelerOfDeposit use. One function for "traveler unified
    // balance" so the wallet card, the pre-pay funds gate, and the
    // post-deposit ping all agree on the number.
    const { getTravelerUnifiedBalance } = await import('@sendero/circle/traveler-unified-balance');
    const unified = await getTravelerUnifiedBalance({ userId });
    if (unified.resolvedFrom === 'no_wallet') {
      return {
        status: 'no_wallet',
        message:
          'Wallet provisioning is still in progress. Try again in a few seconds — the next inbound will provision the Gateway depositor.',
      };
    }

    // Map chainId → GatewayChainKey for the per-chain wallet-card
    // render. This is the tool's display concern, not the balance
    // concern; balance lives in `unified`.
    const auditRows = unified.evmDcwAddresses.flatMap(row => {
      const chainKey = chainIdToGatewayKey(row.chainId);
      if (!chainKey) {
        console.warn('[traveler_balance] EVM Wallet row with unmapped chainId — dropping', {
          userId,
          chainId: row.chainId,
        });
        return [];
      }
      return [{ chainKey, address: row.address }];
    });
    const evmAudit = auditEvmAddresses(auditRows);

    return {
      total: unified.total,
      balances: unified.balances,
      // Single safe value — populated only when every EVM row uses the
      // same address. Renderers SHOULD prefer this; the per-chain map
      // exists for divergent edge cases.
      evmAddress: evmAudit.canonical,
      // Always populated. Lets WhatsApp / Slack render per-chain when
      // divergent without a second DB call.
      evmAddresses: evmAudit.perChain,
      evmAddressesDivergent: evmAudit.divergent,
      solanaAddress: unified.solanaAddress,
      signerAddress: unified.signerAddress,
    };
  },
};

/**
 * @deprecated Legacy alias — kept for Kapso graphs + MCP clients pinned
 * to the pre-split tool name. Now routes to `traveler_balance` (NOT
 * `treasury_balance`). In every existing call site, the agent asked
 * "what's the user's wallet balance" and got tenant-pool numbers
 * instead — a misleading bug that pre-dated the split. The new alias
 * matches the documented intent: "user's own wallet" → traveler view.
 */
export const gatewayBalanceTool: ToolDef = {
  ...travelerBalanceTool,
  name: 'gateway_balance',
  description:
    "[Legacy alias of `traveler_balance`] Return the SIGNED-IN TRAVELER's USDC unified balance across every Gateway-supported testnet. Use `traveler_balance` directly in new code; `treasury_balance` for the tenant pool.",
};
