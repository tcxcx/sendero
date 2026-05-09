import { prisma } from '@sendero/database';
import { canonicalSplit, settleCommissionSplit } from '@sendero/nanopayments';
import { z } from 'zod';

import { requirePlatformTreasuryDestination } from './platform-treasury';
import type { ToolDef } from './types';

const inputSchema = z.object({
  gross: z.string().describe('Total booking amount in USDC (decimal string).'),
  supplier: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  commissionBps: z.number().int().default(1000),
  senderoFeeBps: z.number().int().default(100),
  /**
   * Override agency address for this call. Rare — normally we resolve
   * the tenant's address from TenantGatewayConfig (Phase 1) or the
   * tenant's treasury CircleWallet (fallback). Only set this when the
   * caller is replaying an old booking against a custom address.
   */
  agencyAddressOverride: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

/**
 * Resolve the agency leg's destination address for a tenant. Priority:
 *   1. `CircleWallet(kind='operations', chain='ARC-TESTNET')` — the
 *      Gateway deposit staging wallet. Inbound agency profit sweeps
 *      into the tenant's unified Gateway balance via the Circle webhook.
 *   2. `TenantGatewayConfig.evmDepositorAddress` — fallback to the
 *      per-tenant Gateway EOA when the ops wallet is not provisioned.
 *   3. `CircleWallet(kind='treasury')` — legacy fallback until the
 *      Gateway backfill has completed.
 *   4. `DEMO_CLIENT_ADDRESS` env — the legacy demo address. Last
 *      resort, only when neither (1) nor (2) is available (e.g. tools
 *      called without tenant context, or manual replays).
 */
async function resolveAgencyAddress(tenantId: string | undefined): Promise<`0x${string}`> {
  if (tenantId) {
    const operations = await prisma.circleWallet.findFirst({
      where: { tenantId, kind: 'operations', chain: 'ARC-TESTNET' },
      select: { address: true },
    });
    if (operations?.address) {
      return operations.address as `0x${string}`;
    }

    const config = await prisma.tenantGatewayConfig.findUnique({
      where: { tenantId },
      select: { evmDepositorAddress: true },
    });
    if (config?.evmDepositorAddress) {
      return config.evmDepositorAddress as `0x${string}`;
    }
    const treasury = await prisma.circleWallet.findFirst({
      where: { tenantId, kind: 'treasury' },
      select: { address: true },
    });
    if (treasury?.address) {
      return treasury.address as `0x${string}`;
    }
  }
  return (
    (process.env.DEMO_CLIENT_ADDRESS as `0x${string}`) ||
    '0x6a5d2a2e56ed5162f5e29fe1179e59f2b07140e7'
  );
}

export const settleSplitTool: ToolDef = {
  name: 'settle_split',
  description:
    'Execute a canonical commission fan-out on Arc Testnet in a single batch: gross splits atomically into supplier net + agency commission + Sendero rail + validator tip. Pass gross + supplier address; the agency leg routes to the caller tenant by default.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['gross', 'supplier'],
    properties: {
      gross: {
        type: 'string',
        description: 'Total booking amount in USDC (decimal string).',
      },
      supplier: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      commissionBps: { type: 'integer', default: 1000 },
      senderoFeeBps: { type: 'integer', default: 100 },
      agencyAddressOverride: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{40}$',
        description:
          'Override the resolved tenant agency address. Used for replays against a custom address; normally omitted.',
      },
    },
  },
  async handler(input: z.infer<typeof inputSchema>, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    const agency =
      (input.agencyAddressOverride as `0x${string}` | undefined) ??
      (await resolveAgencyAddress(tenantId));
    const senderoTreasury = await requirePlatformTreasuryDestination('arc', 'settle_split');

    const legs = canonicalSplit({
      gross: input.gross,
      supplier: input.supplier as `0x${string}`,
      agency,
      sendero: senderoTreasury.address as `0x${string}`,
      validator:
        (process.env.AUX_VALIDATOR_1_ADDRESS as `0x${string}`) ||
        '0x22f7536934d6a00ade239474465b823418dd84bc',
      commissionBps: input.commissionBps ?? 1000,
      senderoFeeBps: input.senderoFeeBps ?? 100,
    });
    return settleCommissionSplit(legs);
  },
};
