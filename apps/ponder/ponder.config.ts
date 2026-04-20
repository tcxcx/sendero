import { createConfig } from 'ponder';
import { http } from 'viem';
import { SenderoGuestEscrowAbi } from './abis/SenderoGuestEscrow.abi';

/**
 * Ponder indexer for SenderoGuestEscrow on Arc Testnet.
 *
 * Env vars:
 *   PONDER_RPC_URL_ARC_TESTNET  — Arc Testnet RPC
 *   DATABASE_URL                — Postgres (production only; defaults
 *                                 to SQLite file in dev)
 *   PONDER_ESCROW_ADDRESS       — override if redeploying
 *   PONDER_ESCROW_START_BLOCK   — override if redeploying
 */
export default createConfig({
  chains: {
    arcTestnet: {
      id: 5042002,
      rpc: http(
        process.env.PONDER_RPC_URL_ARC_TESTNET ?? 'https://rpc.testnet.arc.network',
      ),
    },
  },
  contracts: {
    SenderoGuestEscrow: {
      chain: 'arcTestnet',
      abi: SenderoGuestEscrowAbi,
      address: (process.env.PONDER_ESCROW_ADDRESS ??
        '0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515') as `0x${string}`,
      startBlock: Number(process.env.PONDER_ESCROW_START_BLOCK ?? 38197708),
    },
  },
});
