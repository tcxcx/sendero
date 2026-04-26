/**
 * Resolve a Circle DCW wallet UUID from an on-chain 0x address.
 *
 * Circle's `createContractExecutionTransaction` accepts EITHER `walletId`
 * (UUID) OR `walletAddress` (0x address + `blockchain` field). We always
 * route through `walletId`, so any code path that has only the address
 * needs to look up the UUID first. Both user-scoped (`Wallet`) and
 * tenant-scoped (`CircleWallet`) tables enforce a UNIQUE on `address`,
 * so a single address can resolve at most one row in each.
 *
 * Returns null when neither table has a matching row, or when the row
 * exists but has no `circleWalletId` (legacy / non-Circle wallet).
 */

import { prisma } from '@sendero/database';

export async function resolveWalletUuidByAddress(address: string): Promise<string | null> {
  // Use case-insensitive match — `Wallet.address` is stored as Circle returns
  // it (lowercase today), but EVM addresses can also appear checksummed in
  // input from clients / agent tool calls.
  const [user, org] = await Promise.all([
    prisma.wallet.findFirst({
      where: { address: { equals: address, mode: 'insensitive' } },
      select: { circleWalletId: true },
    }),
    prisma.circleWallet.findFirst({
      where: { address: { equals: address, mode: 'insensitive' } },
      select: { circleWalletId: true },
    }),
  ]);
  return user?.circleWalletId ?? org?.circleWalletId ?? null;
}
