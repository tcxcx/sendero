/**
 * Read current owners of the Arc MSCA via the WeightedWebauthnMultisigPlugin
 * using the canonical ABI lifted from desk-v1 (smart-wallet.controller.ts).
 *
 * Run: bun scripts/_debug-arc-ownership.ts
 */
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';

const MSCA: Address = '0xdF17bb2BEad222A63EF529485A5207600ecCe5B9';
const PLUGIN: Address = '0x0000000C984AFf541D6cE86Bb697e68ec57873C8';
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

const OWNERSHIP_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'ownershipInfoOf',
    outputs: [
      { name: 'ownerAddresses', type: 'bytes30[]' },
      {
        name: 'ownersData',
        type: 'tuple[]',
        components: [
          { name: 'weight', type: 'uint256' },
          { name: 'credType', type: 'uint8' },
          { name: 'addr', type: 'address' },
          { name: 'publicKeyX', type: 'uint256' },
          { name: 'publicKeyY', type: 'uint256' },
        ],
      },
      { name: 'thresholdWeight', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

async function main() {
  console.log('MSCA:  ', MSCA);
  console.log('PLUGIN:', PLUGIN);
  console.log('');
  const info = await client.readContract({
    address: PLUGIN,
    abi: OWNERSHIP_ABI,
    functionName: 'ownershipInfoOf',
    args: [MSCA],
  });
  const ownersData = info[1];
  const thresholdWeight = info[2];
  console.log('thresholdWeight:', thresholdWeight.toString());
  console.log('owners count:   ', ownersData.length);
  for (const o of ownersData) {
    console.log('  -', {
      weight: o.weight.toString(),
      credType: o.credType,
      addr: o.addr,
      hasPubKey: o.publicKeyX !== 0n || o.publicKeyY !== 0n,
    });
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
