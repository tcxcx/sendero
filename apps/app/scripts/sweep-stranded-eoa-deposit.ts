#!/usr/bin/env bun
/**
 * One-shot recovery: sweep a traveler's stranded EOA balance into
 * Circle Gateway via EIP-3009 ReceiveWithAuthorization.
 *
 * Why: the traveler sent USDC directly to their UserGatewaySigner
 * EOA on Arc Testnet. Circle doesn't track that address (it's a
 * locally-generated EOA, not a Circle DCW), so no webhook fired.
 * The structural fix is to route deposits through the Circle DCW
 * EVM address instead. Until that lands, this script claims the
 * stranded balance manually.
 *
 * Flow:
 *   1. Decrypt UserGatewaySigner private key for the user.
 *   2. Read live USDC balance on Arc Testnet for that EOA.
 *   3. Sign EIP-3009 ReceiveWithAuthorization (zero gas — chainId-bound).
 *   4. Sponsor (treasury EOA) submits GatewayWallet.depositWithAuthorization.
 *   5. Wait for confirmation.
 *   6. Verify Gateway /balances reports the new amount.
 *
 * Idempotent in the sense that re-running with no EOA balance is a
 * no-op. Two parallel runs would race on the nonce — don't.
 */

import { randomBytes } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  hexToSignature,
  http,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { arcTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

import { getUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { queryUnifiedBalance } from '@sendero/circle/gateway';
import { env } from '@sendero/env';

const USER_ID = process.argv[2];
if (!USER_ID) {
  console.error('Usage: bun run scripts/_local/sweep-traveler-eoa-into-gateway.ts <userId>');
  process.exit(2);
}

const ARC_USDC: Address = '0x3600000000000000000000000000000000000000';
const GATEWAY_WALLET: Address = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const RPC_URL = env.arcRpcUrl();

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });

console.log(`\nResolving UserGatewaySigner for ${USER_ID}…`);
const signer = await getUserGatewaySigner(USER_ID, {
  caller: { surface: 'cli', userId: USER_ID, context: 'sweep-traveler-eoa' },
});
if (!signer) {
  console.error(`No UserGatewaySigner row for ${USER_ID}`);
  process.exit(1);
}
console.log(`  EOA: ${signer.address}`);

console.log(`\nReading live USDC balance on Arc Testnet…`);
const eoaBalance = (await publicClient.readContract({
  address: ARC_USDC,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [signer.address as Address],
} as never)) as bigint;
console.log(`  raw: ${eoaBalance.toString()} (${Number(eoaBalance) / 1e6} USDC)`);

if (eoaBalance === 0n) {
  console.log(`\nNothing to sweep. Exiting clean.`);
  process.exit(0);
}

// Arc's account model rejects clearing a USDC account to exactly zero
// ("Cannot clear balance of empty account"). Leave 0.01 USDC dust.
let amountBaseUnits = eoaBalance;
const dust = 10_000n;
amountBaseUnits -= dust;
console.log(`  sweeping: ${amountBaseUnits.toString()} (leaving ${dust} dust on-chain)`);

console.log(`\nReading USDC token domain (name, version)…`);
const usdcAbiExt = [
  ...erc20Abi,
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'version',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;
const [tokenName, tokenVersion] = await Promise.all([
  publicClient.readContract({
    address: ARC_USDC,
    abi: usdcAbiExt,
    functionName: 'name',
  } as never) as Promise<string>,
  publicClient.readContract({
    address: ARC_USDC,
    abi: usdcAbiExt,
    functionName: 'version',
  } as never) as Promise<string>,
]);
console.log(`  ${tokenName} v${tokenVersion}`);

const nowSec = Math.floor(Date.now() / 1000);
const validAfter = 0n;
const validBefore = BigInt(nowSec + 60 * 30);
const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;

const message = {
  from: signer.address as Address,
  to: GATEWAY_WALLET,
  value: amountBaseUnits,
  validAfter,
  validBefore,
  nonce,
};

console.log(`\nSigning EIP-3009 ReceiveWithAuthorization with the user's EOA…`);
const signature = await signer.account.signTypedData({
  types: {
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  domain: {
    name: tokenName,
    version: tokenVersion,
    chainId: arcTestnet.id,
    verifyingContract: ARC_USDC,
  },
  primaryType: 'ReceiveWithAuthorization',
  message,
});
const { r, s, v } = hexToSignature(signature);
console.log(`  signed (v=${v})`);

console.log(`\nLoading sponsor (TREASURY_PRIVATE_KEY)…`);
const treasuryHex = env.treasuryPrivateKey();
if (!treasuryHex) throw new Error('TREASURY_PRIVATE_KEY required');
const sponsor = privateKeyToAccount(
  (treasuryHex.startsWith('0x') ? treasuryHex : `0x${treasuryHex}`) as Hex
);
console.log(`  sponsor: ${sponsor.address}`);

console.log(`\nSubmitting GatewayWallet.depositWithAuthorization on Arc…`);
const wallet = createWalletClient({
  account: sponsor,
  chain: arcTestnet,
  transport: http(RPC_URL),
});
const depositAbi = [
  {
    name: 'depositWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

const txHash = await wallet.writeContract({
  address: GATEWAY_WALLET,
  abi: depositAbi,
  functionName: 'depositWithAuthorization',
  args: [
    ARC_USDC,
    signer.address as Address,
    amountBaseUnits,
    validAfter,
    validBefore,
    nonce,
    Number(v),
    r,
    s,
  ],
  account: sponsor,
  chain: arcTestnet,
});
console.log(`  tx: ${txHash}`);
console.log(`  Arcscan: https://testnet.arcscan.app/tx/${txHash}`);

console.log(`\nWaiting for confirmation…`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
console.log(`  status: ${receipt.status}`);
console.log(`  block: ${receipt.blockNumber}`);

if (receipt.status !== 'success') {
  console.error(`\n✗ Deposit reverted. Check Arcscan: https://testnet.arcscan.app/tx/${txHash}`);
  process.exit(1);
}

console.log(`\nQuerying Gateway unified balance for ${signer.address}…`);
const after = await queryUnifiedBalance({ evm: signer.address as Address });
console.log(`  total: ${after.total} USDC`);
for (const b of after.balances) {
  if (Number(b.balance) > 0) console.log(`    ${b.label}: ${b.balance}`);
}

console.log(
  `\n✓ Sweep complete. ${Number(amountBaseUnits) / 1e6} USDC now in Gateway, registered to ${signer.address}.`
);
process.exit(0);
