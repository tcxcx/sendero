import { createPublicClient, http } from 'viem';
const rpc = process.env.ARC_RPC_URL!;
const operator = '0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69';
const usdc = '0x3600000000000000000000000000000000000000';
const chain = {
  id: 5042002,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpc] }, public: { http: [rpc] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpc) });
const bal = await client.readContract({
  address: usdc as `0x${string}`,
  abi: [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{ type: 'address' }],
      outputs: [{ type: 'uint256' }],
    },
  ] as const,
  functionName: 'balanceOf',
  args: [operator as `0x${string}`],
});
const native = await client.getBalance({ address: operator as `0x${string}` });
console.log('Treasury:', operator);
console.log('USDC balance:', bal.toString(), 'micro   = $' + (Number(bal) / 1_000_000).toFixed(4));
console.log('Native gas:', native.toString(), 'wei');
