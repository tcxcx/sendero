/**
 * Circle Gateway — unified USDC balance across chains with sub-500ms
 * cross-chain transfers. We use the server-side treasury EOA (the same
 * key backing `lib/appkit.ts`) as the sole depositor so the demo can
 * show "Pasillo treasury = one balance across Ethereum Sepolia, Base
 * Sepolia, Arc Testnet" and pull to Arc at booking time.
 *
 * Flow:
 *   1. deposit()   — approve USDC + deposit into GatewayWallet on a source chain
 *   2. balance()   — POST /balances to API, aggregate across chains
 *   3. transfer()  — sign EIP-712 burn intent, POST /transfer for attestation,
 *                    then gatewayMint on destination chain (one-shot)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  pad,
  parseUnits,
  zeroAddress,
  erc20Abi,
  maxUint64,
  type Chain,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  arcTestnet,
  baseSepolia,
  sepolia,
  avalancheFuji,
  optimismSepolia,
  polygonAmoy,
  arbitrumSepolia,
} from 'viem/chains';
import { env } from './env';

// ───────────────────────────────────────────────────────────────────
// Contract addresses (Circle Gateway testnet — identical on all EVM)
// ───────────────────────────────────────────────────────────────────

const GATEWAY_WALLET: Address = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const GATEWAY_MINTER: Address = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';

export interface GatewayChain {
  /** Circle domain ID. */
  domain: number;
  /** Human-readable name (UI). */
  label: string;
  /** Machine name matching App Kit bridge enum. */
  kitName: string;
  viemChain: Chain;
  usdc: Address;
  rpcUrl: string;
}

/**
 * Testnet chains Pasillo supports for Gateway. Arc is the settle-here
 * destination; the others are source-chain liquidity buckets.
 */
export const GATEWAY_CHAINS: Record<string, GatewayChain> = {
  Arc_Testnet: {
    domain: 26,
    label: 'Arc Testnet',
    kitName: 'Arc_Testnet',
    viemChain: arcTestnet,
    usdc: '0x3600000000000000000000000000000000000000',
    rpcUrl: 'https://rpc.testnet.arc.network',
  },
  Ethereum_Sepolia: {
    domain: 0,
    label: 'Ethereum Sepolia',
    kitName: 'Ethereum_Sepolia',
    viemChain: sepolia,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  Base_Sepolia: {
    domain: 6,
    label: 'Base Sepolia',
    kitName: 'Base_Sepolia',
    viemChain: baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
  },
  Avalanche_Fuji: {
    domain: 1,
    label: 'Avalanche Fuji',
    kitName: 'Avalanche_Fuji',
    viemChain: avalancheFuji,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    rpcUrl: 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  },
  Optimism_Sepolia: {
    domain: 2,
    label: 'Optimism Sepolia',
    kitName: 'Optimism_Sepolia',
    viemChain: optimismSepolia,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    rpcUrl: 'https://optimism-sepolia-rpc.publicnode.com',
  },
  Arbitrum_Sepolia: {
    domain: 3,
    label: 'Arbitrum Sepolia',
    kitName: 'Arbitrum_Sepolia',
    viemChain: arbitrumSepolia,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpcUrl: 'https://arbitrum-sepolia-rpc.publicnode.com',
  },
  Polygon_Amoy: {
    domain: 7,
    label: 'Polygon Amoy',
    kitName: 'Polygon_Amoy_Testnet',
    viemChain: polygonAmoy,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com',
  },
};

export const GATEWAY_SOURCE_CHAINS = Object.keys(GATEWAY_CHAINS).filter(
  (k) => k !== 'Arc_Testnet',
) as Array<keyof typeof GATEWAY_CHAINS>;

// ───────────────────────────────────────────────────────────────────
// EIP-712 typing (do not modify — exact spec from Gateway docs)
// ───────────────────────────────────────────────────────────────────

const EIP712_DOMAIN = { name: 'GatewayWallet', version: '1' } as const;

const EIP712_TYPES = {
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
} as const;

const gatewayWalletAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const gatewayMinterAbi = [
  {
    type: 'function',
    name: 'gatewayMint',
    inputs: [
      { name: 'attestationPayload', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/** 2.01 USDC fee cap per burn intent (Gateway recommended default). */
const MAX_FEE = 2_010_000n;

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function addressToBytes32(a: Address): Hex {
  return pad(a.toLowerCase() as Hex, { size: 32 });
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

function treasuryAccount() {
  const pk = env.treasuryPrivateKey();
  if (!pk) {
    throw new Error(
      'TREASURY_PRIVATE_KEY required for Gateway operations.',
    );
  }
  return privateKeyToAccount(pk as Hex);
}

function publicClientFor(chain: GatewayChain) {
  return createPublicClient({
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
}

function walletClientFor(chain: GatewayChain) {
  return createWalletClient({
    account: treasuryAccount(),
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
}

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

export interface GatewayBalance {
  chain: string;
  domain: number;
  label: string;
  balance: string;
}

/**
 * Query the unified Gateway balance for a depositor across all
 * Pasillo-tracked testnet chains in one round-trip.
 */
export async function queryUnifiedBalance(
  depositor?: Address,
): Promise<{ total: string; balances: GatewayBalance[] }> {
  const acct = depositor ?? treasuryAccount().address;
  const sources = Object.values(GATEWAY_CHAINS).map((c) => ({
    domain: c.domain,
    depositor: acct,
  }));

  const res = await fetch(`${GATEWAY_API}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources }),
  });
  if (!res.ok) {
    throw new Error(
      `Gateway /balances failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    balances: Array<{ domain: number; balance: string }>;
  };

  const balances: GatewayBalance[] = Object.values(GATEWAY_CHAINS).map((c) => {
    const match = data.balances.find((b) => b.domain === c.domain);
    return {
      chain: c.kitName,
      domain: c.domain,
      label: c.label,
      balance: match?.balance ?? '0.000000',
    };
  });

  const total = balances
    .reduce((sum, b) => sum + Number(b.balance || 0), 0)
    .toFixed(6);

  return { total, balances };
}

/**
 * Deposit USDC from the treasury EOA into Gateway on a given source
 * chain. Used to seed liquidity before demos.
 */
export async function depositToGateway(
  sourceChainKey: keyof typeof GATEWAY_CHAINS,
  amountUsdc: string,
): Promise<{ approveHash: Hex; depositHash: Hex }> {
  const chain = GATEWAY_CHAINS[sourceChainKey];
  if (!chain) throw new Error(`Unknown Gateway source chain: ${sourceChainKey}`);

  const wallet = walletClientFor(chain);
  const pub = publicClientFor(chain);
  const amt = parseUnits(amountUsdc, 6);

  const acct = treasuryAccount();
  const approveHash = await wallet.writeContract({
    address: chain.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [GATEWAY_WALLET, amt],
    account: acct,
    chain: chain.viemChain,
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  const depositHash = await wallet.writeContract({
    address: GATEWAY_WALLET,
    abi: gatewayWalletAbi,
    functionName: 'deposit',
    args: [chain.usdc, amt],
    account: acct,
    chain: chain.viemChain,
  });
  await pub.waitForTransactionReceipt({ hash: depositHash });

  return { approveHash, depositHash };
}

/**
 * Transfer from Gateway unified balance: sign burn intent → submit to
 * Gateway API → call gatewayMint on destination. All server-side with
 * treasury EOA signing. Returns the mint tx hash on destination chain.
 */
export async function transferViaGateway(params: {
  from: keyof typeof GATEWAY_CHAINS;
  to: keyof typeof GATEWAY_CHAINS;
  amountUsdc: string;
  recipient?: Address;
}): Promise<{
  burnSignature: Hex;
  mintHash: Hex;
  explorerUrl: string;
  attestation: Hex;
  apiSignature: Hex;
}> {
  const src = GATEWAY_CHAINS[params.from];
  const dst = GATEWAY_CHAINS[params.to];
  if (!src || !dst) {
    throw new Error(
      `Unknown Gateway chain pair: ${params.from} → ${params.to}`,
    );
  }

  const acct = treasuryAccount();
  const recipient = (params.recipient ?? acct.address) as Address;
  const value = parseUnits(params.amountUsdc, 6);

  const burnIntent = {
    maxBlockHeight: maxUint64,
    maxFee: MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: src.domain,
      destinationDomain: dst.domain,
      sourceContract: addressToBytes32(GATEWAY_WALLET),
      destinationContract: addressToBytes32(GATEWAY_MINTER),
      sourceToken: addressToBytes32(src.usdc),
      destinationToken: addressToBytes32(dst.usdc),
      sourceDepositor: addressToBytes32(acct.address),
      destinationRecipient: addressToBytes32(recipient),
      sourceSigner: addressToBytes32(acct.address),
      destinationCaller: addressToBytes32(zeroAddress),
      value,
      salt: randomSalt(),
      hookData: '0x' as Hex,
    },
  };

  const burnSignature = await acct.signTypedData({
    domain: EIP712_DOMAIN,
    primaryType: 'BurnIntent',
    types: EIP712_TYPES,
    message: burnIntent,
  });

  // Serialize bigints for the API — Gateway expects decimal strings.
  const burnIntentWire = {
    maxBlockHeight: burnIntent.maxBlockHeight.toString(),
    maxFee: burnIntent.maxFee.toString(),
    spec: {
      ...burnIntent.spec,
      value: burnIntent.spec.value.toString(),
    },
  };
  const res = await fetch(`${GATEWAY_API}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { burnIntent: burnIntentWire, signature: burnSignature },
    ]),
  });
  if (!res.ok) {
    throw new Error(
      `Gateway /transfer failed: ${res.status} ${await res.text()}`,
    );
  }
  const { attestation, signature: apiSignature } = (await res.json()) as {
    attestation: Hex;
    signature: Hex;
  };

  const dstWallet = walletClientFor(dst);
  const dstPub = publicClientFor(dst);
  const mintHash = await dstWallet.writeContract({
    address: GATEWAY_MINTER,
    abi: gatewayMinterAbi,
    functionName: 'gatewayMint',
    args: [attestation, apiSignature],
    account: acct,
    chain: dst.viemChain,
  });
  await dstPub.waitForTransactionReceipt({ hash: mintHash });

  const explorerUrl =
    dst.kitName === 'Arc_Testnet'
      ? `https://testnet.arcscan.app/tx/${mintHash}`
      : `${dst.viemChain.blockExplorers?.default?.url ?? ''}/tx/${mintHash}`;

  return {
    burnSignature,
    mintHash,
    explorerUrl,
    attestation,
    apiSignature,
  };
}
