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
    // Architecture flip (2026-05-04): the EVM Gateway depositor is now
    // the traveler's Circle DCW EVM address — Circle's webhook system
    // tracks these, so transactions.inbound fires and we auto-deposit.
    // UserGatewaySigner EOAs are off Circle's radar; funds sent there
    // strand silently. The signer row is still surfaced separately
    // (for stranded-fund recovery), but the DCW is the source of truth
    // for balance reads.
    //
    // Cross-chain audit (2026-05-04): we used to return ONE canonical
    // EVM address with the assumption "Circle DCWs are deterministic,
    // every chain shares the same SCA address". That assumption fails
    // for tenant treasury wallets (Arc has its own address, others
    // share another) and could fail for travelers in the future. We
    // now query EVERY EVM DCW row and run `auditEvmAddresses`. When
    // all chains agree, `evmAddress` carries the canonical value
    // (same as before). When they diverge, `evmAddress` is null and
    // `evmAddresses` lists each chain explicitly so the renderer
    // can't show an unsafe "valid for all chains" address.
    const [evmDcwRows, solanaWallet, signer] = await Promise.all([
      prisma.wallet.findMany({
        where: {
          userId,
          provisioner: 'dcw',
          NOT: { chainId: SOL_DEVNET_CHAIN_ID },
        },
        orderBy: { createdAt: 'asc' },
        select: { address: true, chainId: true },
      }),
      prisma.wallet.findFirst({
        where: { userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
        select: { address: true },
      }),
      getUserGatewaySigner(userId, {
        caller: { surface: 'tool', userId, context: 'traveler_balance' },
      }),
    ]);
    if (evmDcwRows.length === 0 && !solanaWallet) {
      return {
        status: 'no_wallet',
        message:
          'Wallet provisioning is still in progress. Try again in a few seconds — the next inbound will provision the Gateway depositor.',
      };
    }

    // Map chainId → GatewayChainKey for audit. Rows whose chainId isn't
    // in `GATEWAY_CHAINS` get dropped with a console-noted warning;
    // they shouldn't reach the wallet card anyway.
    const auditRows = evmDcwRows.flatMap(row => {
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

    // For the Gateway REST query we still need ONE EVM depositor —
    // the canonical when safe, otherwise the first row (Gateway
    // queries are per-domain, not address-bound; the divergence flag
    // tells the agent to surface caveat in the wallet card).
    const evmForBalance = (evmAudit.canonical ?? evmDcwRows[0]?.address ?? null) as Address | null;
    const balance = await queryUnifiedBalance({
      evm: evmForBalance ?? undefined,
      solana: solanaWallet?.address ?? undefined,
    });

    return {
      ...balance,
      // Single safe value — populated only when every EVM row uses the
      // same address. Renderers SHOULD prefer this; the per-chain map
      // exists for divergent edge cases.
      evmAddress: evmAudit.canonical,
      // Always populated. Lets WhatsApp / Slack render per-chain when
      // divergent without a second DB call.
      evmAddresses: evmAudit.perChain,
      evmAddressesDivergent: evmAudit.divergent,
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
