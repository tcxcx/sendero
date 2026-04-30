/**
 * Circle Gateway — unified USDC balance across chains with sub-500ms
 * cross-chain transfers. We use the server-side treasury EOA (the same
 * key backing `lib/appkit.ts`) as the sole depositor so the demo can
 * show "Sendero treasury = one balance across Ethereum Sepolia, Base
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
  type PrivateKeyAccount,
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
import { env } from '@sendero/env';

// ───────────────────────────────────────────────────────────────────
// Contract addresses (Circle Gateway testnet — identical on all EVM)
// ───────────────────────────────────────────────────────────────────

const GATEWAY_WALLET: Address = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const GATEWAY_MINTER: Address = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';

/**
 * Shared fields across all Gateway chains regardless of runtime kind.
 * Every entry has these — discriminated union below adds runtime-specific
 * fields.
 */
interface GatewayChainBase {
  /** Circle domain ID. Same on testnet + mainnet for a given chain
   *  (e.g. SOL = 5, AVAX = 1, ARC = 26). */
  domain: number;
  /** Human-readable name (UI). */
  label: string;
  /** Machine name matching App Kit bridge enum (legacy underscored
   *  format — kept for App Kit interop only). */
  kitName: string;
  /** Circle blockchain identifier in the dashed format. Matches:
   *  - circle_wallets.chain column values
   *  - Circle webhook notification.blockchain field
   *  - Circle SDK createWallets({blockchains:[...]}) arg
   *  This is the canonical id for everything except App Kit calls. */
  circleId: string;
  /** RPC endpoint Sendero uses for this chain (viem on EVM,
   *  @solana/web3.js Connection on Solana). */
  rpcUrl: string;
}

/** EVM chain config (Arc, Avalanche, Base, Optimism, Arbitrum, Polygon, Ethereum). */
export interface GatewayEvmChain extends GatewayChainBase {
  kind: 'evm';
  viemChain: Chain;
  /** USDC contract address (0x… hex). */
  usdc: Address;
}

/** Solana chain config (SOL-DEVNET, SOL mainnet). */
export interface GatewaySolanaChain extends GatewayChainBase {
  kind: 'solana';
  /** USDC SPL Token mint address (base58). */
  usdcMint: string;
  /** Circle Gateway Minter program address on Solana (base58). The
   *  destinationContract for burn intents targeting Solana. */
  gatewayMinterProgram: string;
}

/**
 * Discriminated union — every consumer that touches chain-specific
 * fields must check `chain.kind` first. EVM-only paths (depositToGateway,
 * existing /api/gateway/balance) fast-fail when handed a Solana entry;
 * Solana-only paths (gateway-solana-mint) likewise. The compiler
 * enforces both directions.
 */
export type GatewayChain = GatewayEvmChain | GatewaySolanaChain;

/**
 * Testnet chains Sendero supports for Gateway. Arc is the settle-here
 * destination; the others are source-chain liquidity buckets.
 */
export const GATEWAY_CHAINS: Record<string, GatewayChain> = {
  Arc_Testnet: {
    domain: 26,
    label: 'Arc Testnet',
    kind: 'evm',
    kitName: 'Arc_Testnet',
    circleId: 'ARC-TESTNET',
    viemChain: arcTestnet,
    usdc: '0x3600000000000000000000000000000000000000',
    rpcUrl: 'https://rpc.testnet.arc.network',
  },
  Ethereum_Sepolia: {
    domain: 0,
    label: 'Ethereum Sepolia',
    kind: 'evm',
    kitName: 'Ethereum_Sepolia',
    circleId: 'ETH-SEPOLIA',
    viemChain: sepolia,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  Base_Sepolia: {
    domain: 6,
    label: 'Base Sepolia',
    kind: 'evm',
    kitName: 'Base_Sepolia',
    circleId: 'BASE-SEPOLIA',
    viemChain: baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
  },
  Avalanche_Fuji: {
    domain: 1,
    label: 'Avalanche Fuji',
    kind: 'evm',
    kitName: 'Avalanche_Fuji',
    circleId: 'AVAX-FUJI',
    viemChain: avalancheFuji,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    rpcUrl: 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  },
  Optimism_Sepolia: {
    domain: 2,
    label: 'Optimism Sepolia',
    kind: 'evm',
    kitName: 'Optimism_Sepolia',
    circleId: 'OP-SEPOLIA',
    viemChain: optimismSepolia,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    rpcUrl: 'https://optimism-sepolia-rpc.publicnode.com',
  },
  Arbitrum_Sepolia: {
    domain: 3,
    label: 'Arbitrum Sepolia',
    kind: 'evm',
    kitName: 'Arbitrum_Sepolia',
    circleId: 'ARB-SEPOLIA',
    viemChain: arbitrumSepolia,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpcUrl: 'https://arbitrum-sepolia-rpc.publicnode.com',
  },
  Polygon_Amoy: {
    domain: 7,
    label: 'Polygon Amoy',
    kind: 'evm',
    kitName: 'Polygon_Amoy_Testnet',
    circleId: 'MATIC-AMOY',
    viemChain: polygonAmoy,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com',
  },
  Sol_Devnet: {
    domain: 5,
    label: 'Solana Devnet',
    kind: 'solana',
    kitName: 'Sol_Devnet',
    circleId: 'SOL-DEVNET',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    // Circle Gateway Minter program on Solana devnet. Source-of-truth:
    // desk-v1 packages/env/src/gateway.ts (verified 2026-04-18).
    gatewayMinterProgram: 'GATEmKK2ECL1brEngQZWCgMWPbvrEYqsV6u29dAaHavr',
    rpcUrl: 'https://api.devnet.solana.com',
  },
  Sol: {
    domain: 5,
    label: 'Solana',
    kind: 'solana',
    kitName: 'Sol',
    circleId: 'SOL',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    gatewayMinterProgram: 'GATEm5SoBJiSw1v2Pz1iPBgUYkXzCUJ27XSXhDfSyzVZ',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
};

/** Type guard — narrow GatewayChain to GatewayEvmChain. */
export function isEvmChain(c: GatewayChain): c is GatewayEvmChain {
  return c.kind === 'evm';
}

/** Type guard — narrow GatewayChain to GatewaySolanaChain. */
export function isSolanaChain(c: GatewayChain): c is GatewaySolanaChain {
  return c.kind === 'solana';
}

export const GATEWAY_SOURCE_CHAINS = Object.keys(GATEWAY_CHAINS).filter(
  k => k !== 'Arc_Testnet'
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
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

function treasuryAccount() {
  const pk = env.treasuryPrivateKey();
  if (!pk) {
    throw new Error('TREASURY_PRIVATE_KEY required for Gateway operations.');
  }
  return privateKeyToAccount(pk as Hex);
}

function publicClientFor(chain: GatewayEvmChain) {
  return createPublicClient({
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
}

function walletClientFor(chain: GatewayEvmChain) {
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
 * Sendero-tracked testnet chains in one round-trip.
 */
export async function queryUnifiedBalance(
  depositor?: Address
): Promise<{ total: string; balances: GatewayBalance[] }> {
  const acct = depositor ?? treasuryAccount().address;
  const sources = Object.values(GATEWAY_CHAINS).map(c => ({
    domain: c.domain,
    depositor: acct,
  }));

  const res = await fetch(`${GATEWAY_API}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources }),
  });
  if (!res.ok) {
    throw new Error(`Gateway /balances failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    balances: Array<{ domain: number; balance: string }>;
  };

  const balances: GatewayBalance[] = Object.values(GATEWAY_CHAINS).map(c => {
    const match = data.balances.find(b => b.domain === c.domain);
    return {
      chain: c.kitName,
      domain: c.domain,
      label: c.label,
      balance: match?.balance ?? '0.000000',
    };
  });

  const total = balances.reduce((sum, b) => sum + Number(b.balance || 0), 0).toFixed(6);

  return { total, balances };
}

/**
 * Deposit USDC from the treasury EOA into Gateway on a given source
 * chain. Used to seed liquidity before demos.
 */
export async function depositToGateway(
  sourceChainKey: keyof typeof GATEWAY_CHAINS,
  amountUsdc: string
): Promise<{ approveHash: Hex; depositHash: Hex }> {
  const chain = GATEWAY_CHAINS[sourceChainKey];
  if (!chain) throw new Error(`Unknown Gateway source chain: ${sourceChainKey}`);
  if (!isEvmChain(chain)) {
    throw new Error(
      `depositToGateway: Solana sources not supported on this legacy path — ` +
        `use the Solana-specific deposit flow (Phase 4.5+).`
    );
  }

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
 * Gateway API → call gatewayMint on destination. Returns the mint tx
 * hash on destination chain.
 *
 * Pass `signer` to use a per-tenant Gateway EOA (Phase 1+ path —
 * mandatory for tenant-scoped operator routes). Omit it to fall back
 * to the platform `TREASURY_PRIVATE_KEY` for legacy callers (the
 * `gateway_transfer` MCP tool until it migrates in Phase 2+).
 *
 * The `signer` IS the recorded Gateway depositor — it signs both the
 * burn intent and the destination mint tx. Caller must ensure the
 * signer's address has previously deposited liquidity into Gateway
 * (sweepChain is the canonical funding path).
 */
export async function transferViaGateway(params: {
  from: keyof typeof GATEWAY_CHAINS;
  to: keyof typeof GATEWAY_CHAINS;
  amountUsdc: string;
  /** EVM destination: 0x address. Solana destination: base58 address
   *  (wallet OR token account — `gateway-solana-mint.resolveSolanaUsdcRecipient`
   *  derives the ATA when given a wallet). */
  recipient?: string;
  /** Optional per-tenant signer. Defaults to platform TREASURY_PRIVATE_KEY. */
  signer?: PrivateKeyAccount;
}): Promise<{
  burnSignature: Hex;
  /** EVM destination: 66-char tx hash. Solana destination: 88-char signature. */
  mintHash: string;
  explorerUrl: string;
  attestation: Hex;
  apiSignature: Hex;
}> {
  const src = GATEWAY_CHAINS[params.from];
  const dst = GATEWAY_CHAINS[params.to];
  if (!src || !dst) {
    throw new Error(`Unknown Gateway chain pair: ${params.from} → ${params.to}`);
  }
  if (!isEvmChain(src)) {
    throw new Error(
      `transferViaGateway: Solana sources not yet supported (Phase 4 = Solana destination only). ` +
        `Phase 4.5 will add Solana → EVM transfers.`
    );
  }

  const acct = params.signer ?? treasuryAccount();
  const value = parseUnits(params.amountUsdc, 6);

  // Lazy-load Solana helpers only when the destination needs them. Keeps
  // EVM-only callers (the gateway_transfer MCP tool, App Kit ops) from
  // pulling @solana/web3.js into their bundle.
  const solanaHelpers = isSolanaChain(dst) ? await import('./gateway-solana-mint') : null;

  // Build burn-intent spec. EVM destinations: left-pad 0x addresses to
  // bytes32. Solana destinations: base58-decode 32-byte PublicKey (no
  // pad). The same EIP-712 signature works for both because the Gateway
  // DOMAIN_SEPARATOR is chain-agnostic (no chainId — that's the whole
  // reason per-tenant EOAs exist for Gateway signing).
  let destinationContractEncoded: Hex;
  let destinationTokenEncoded: Hex;
  let destinationRecipientEncoded: Hex;
  // For Solana destinations: ATA + owner needed at mint time, surfaced
  // here so the post-attest call can use them without re-resolving.
  let solanaMintContext: {
    recipientAta: import('@solana/web3.js').PublicKey;
    recipientOwner: import('@solana/web3.js').PublicKey;
    needsAtaCreate: boolean;
  } | null = null;

  if (isSolanaChain(dst)) {
    if (!solanaHelpers) {
      // Should be unreachable — solanaHelpers is loaded above based on
      // the same dst.kind check. Surfaces clearly if the import fails.
      throw new Error('transferViaGateway: Solana helpers unavailable');
    }
    if (!params.recipient) {
      throw new Error('transferViaGateway: Solana destination requires explicit recipient');
    }
    const resolved = await solanaHelpers.resolveSolanaUsdcRecipient({
      recipient: params.recipient,
      usdcMint: dst.usdcMint,
      rpcUrl: dst.rpcUrl,
    });
    solanaMintContext = resolved;
    destinationContractEncoded = solanaHelpers.solAddressToBytes32(dst.gatewayMinterProgram);
    destinationTokenEncoded = solanaHelpers.solAddressToBytes32(dst.usdcMint);
    destinationRecipientEncoded = solanaHelpers.solAddressToBytes32(
      resolved.recipientAta.toBase58()
    );
  } else if (isEvmChain(dst)) {
    const evmRecipient = (params.recipient ?? acct.address) as Address;
    destinationContractEncoded = addressToBytes32(GATEWAY_MINTER);
    destinationTokenEncoded = addressToBytes32(dst.usdc);
    destinationRecipientEncoded = addressToBytes32(evmRecipient);
  } else {
    // Exhaustiveness — TS narrows dst to never here. If a new chain
    // kind is added without updating this branch, compilation fails.
    const _exhaustive: never = dst;
    throw new Error(`Unhandled chain kind: ${_exhaustive}`);
  }

  const burnIntent = {
    maxBlockHeight: maxUint64,
    maxFee: MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: src.domain,
      destinationDomain: dst.domain,
      sourceContract: addressToBytes32(GATEWAY_WALLET),
      destinationContract: destinationContractEncoded,
      sourceToken: addressToBytes32(src.usdc),
      destinationToken: destinationTokenEncoded,
      sourceDepositor: addressToBytes32(acct.address),
      destinationRecipient: destinationRecipientEncoded,
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
    body: JSON.stringify([{ burnIntent: burnIntentWire, signature: burnSignature }]),
  });
  if (!res.ok) {
    throw new Error(`Gateway /transfer failed: ${res.status} ${await res.text()}`);
  }
  const { attestation, signature: apiSignature } = (await res.json()) as {
    attestation: Hex;
    signature: Hex;
  };

  // Dispatch the destination-side mint based on chain kind.
  if (isSolanaChain(dst) && solanaHelpers && solanaMintContext) {
    const result = await solanaHelpers.mintOnSolana({
      attestation,
      operatorSignature: apiSignature,
      destinationChain: dst,
      recipientAta: solanaMintContext.recipientAta,
      recipientOwner: solanaMintContext.recipientOwner,
      needsAtaCreate: solanaMintContext.needsAtaCreate,
    });
    return {
      burnSignature,
      mintHash: result.txSignature,
      explorerUrl: `https://explorer.solana.com/tx/${result.txSignature}?cluster=${
        dst.circleId === 'SOL-DEVNET' ? 'devnet' : 'mainnet-beta'
      }`,
      attestation,
      apiSignature,
    };
  }

  // EVM destination — existing flow. Type-narrow via isEvmChain.
  if (!isEvmChain(dst)) {
    // Unreachable: covered by the exhaustiveness check above. Keeps the
    // type narrowing happy below the if/else.
    throw new Error('Internal: unhandled non-EVM destination');
  }

  const dstWallet = createWalletClient({
    account: acct,
    chain: dst.viemChain,
    transport: http(dst.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
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

export async function transferViaGatewayFromSources(params: {
  sources: Array<{ from: keyof typeof GATEWAY_CHAINS; amountUsdc: string }>;
  to: keyof typeof GATEWAY_CHAINS;
  /** EVM destination: 0x address. Solana destination: base58 address. */
  recipient?: string;
  /** Optional per-tenant signer. Defaults to platform TREASURY_PRIVATE_KEY. */
  signer?: PrivateKeyAccount;
}): Promise<{
  burnSignature: Hex;
  burnSignatures: Hex[];
  mintHash: string;
  explorerUrl: string;
  attestation: Hex;
  apiSignature: Hex;
}> {
  if (params.sources.length === 0) {
    throw new Error('transferViaGatewayFromSources: at least one source is required');
  }
  if (params.sources.length === 1) {
    const result = await transferViaGateway({
      from: params.sources[0].from,
      to: params.to,
      amountUsdc: params.sources[0].amountUsdc,
      recipient: params.recipient,
      signer: params.signer,
    });
    return { ...result, burnSignatures: [result.burnSignature] };
  }

  const dst = GATEWAY_CHAINS[params.to];
  if (!dst) {
    throw new Error(`Unknown Gateway destination chain: ${params.to}`);
  }

  const acct = params.signer ?? treasuryAccount();
  const solanaHelpers = isSolanaChain(dst) ? await import('./gateway-solana-mint') : null;
  let destinationContractEncoded: Hex;
  let destinationTokenEncoded: Hex;
  let destinationRecipientEncoded: Hex;
  let solanaMintContext: {
    recipientAta: import('@solana/web3.js').PublicKey;
    recipientOwner: import('@solana/web3.js').PublicKey;
    needsAtaCreate: boolean;
  } | null = null;

  if (isSolanaChain(dst)) {
    if (!solanaHelpers) {
      throw new Error('transferViaGatewayFromSources: Solana helpers unavailable');
    }
    if (!params.recipient) {
      throw new Error('transferViaGatewayFromSources: Solana destination requires recipient');
    }
    const resolved = await solanaHelpers.resolveSolanaUsdcRecipient({
      recipient: params.recipient,
      usdcMint: dst.usdcMint,
      rpcUrl: dst.rpcUrl,
    });
    solanaMintContext = resolved;
    destinationContractEncoded = solanaHelpers.solAddressToBytes32(dst.gatewayMinterProgram);
    destinationTokenEncoded = solanaHelpers.solAddressToBytes32(dst.usdcMint);
    destinationRecipientEncoded = solanaHelpers.solAddressToBytes32(
      resolved.recipientAta.toBase58()
    );
  } else if (isEvmChain(dst)) {
    const evmRecipient = (params.recipient ?? acct.address) as Address;
    destinationContractEncoded = addressToBytes32(GATEWAY_MINTER);
    destinationTokenEncoded = addressToBytes32(dst.usdc);
    destinationRecipientEncoded = addressToBytes32(evmRecipient);
  } else {
    const _exhaustive: never = dst;
    throw new Error(`Unhandled chain kind: ${_exhaustive}`);
  }

  const signed = await Promise.all(
    params.sources.map(async source => {
      const src = GATEWAY_CHAINS[source.from];
      if (!src) throw new Error(`Unknown Gateway source chain: ${source.from}`);
      if (!isEvmChain(src)) {
        throw new Error(
          `transferViaGatewayFromSources: Solana sources not yet supported (${source.from}).`
        );
      }
      const burnIntent = {
        maxBlockHeight: maxUint64,
        maxFee: MAX_FEE,
        spec: {
          version: 1,
          sourceDomain: src.domain,
          destinationDomain: dst.domain,
          sourceContract: addressToBytes32(GATEWAY_WALLET),
          destinationContract: destinationContractEncoded,
          sourceToken: addressToBytes32(src.usdc),
          destinationToken: destinationTokenEncoded,
          sourceDepositor: addressToBytes32(acct.address),
          destinationRecipient: destinationRecipientEncoded,
          sourceSigner: addressToBytes32(acct.address),
          destinationCaller: addressToBytes32(zeroAddress),
          value: parseUnits(source.amountUsdc, 6),
          salt: randomSalt(),
          hookData: '0x' as Hex,
        },
      };
      const signature = await acct.signTypedData({
        domain: EIP712_DOMAIN,
        primaryType: 'BurnIntent',
        types: EIP712_TYPES,
        message: burnIntent,
      });
      return {
        burnIntent: {
          maxBlockHeight: burnIntent.maxBlockHeight.toString(),
          maxFee: burnIntent.maxFee.toString(),
          spec: {
            ...burnIntent.spec,
            value: burnIntent.spec.value.toString(),
          },
        },
        signature,
      };
    })
  );

  const res = await fetch(`${GATEWAY_API}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  if (!res.ok) {
    throw new Error(`Gateway /transfer failed: ${res.status} ${await res.text()}`);
  }
  const { attestation, signature: apiSignature } = (await res.json()) as {
    attestation: Hex;
    signature: Hex;
  };

  if (isSolanaChain(dst) && solanaHelpers && solanaMintContext) {
    const result = await solanaHelpers.mintOnSolana({
      attestation,
      operatorSignature: apiSignature,
      destinationChain: dst,
      recipientAta: solanaMintContext.recipientAta,
      recipientOwner: solanaMintContext.recipientOwner,
      needsAtaCreate: solanaMintContext.needsAtaCreate,
    });
    return {
      burnSignature: signed[0].signature,
      burnSignatures: signed.map(item => item.signature),
      mintHash: result.txSignature,
      explorerUrl: `https://explorer.solana.com/tx/${result.txSignature}?cluster=${
        dst.circleId === 'SOL-DEVNET' ? 'devnet' : 'mainnet-beta'
      }`,
      attestation,
      apiSignature,
    };
  }

  if (!isEvmChain(dst)) {
    throw new Error('Internal: unhandled non-EVM destination');
  }

  const dstWallet = createWalletClient({
    account: acct,
    chain: dst.viemChain,
    transport: http(dst.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
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
    burnSignature: signed[0].signature,
    burnSignatures: signed.map(item => item.signature),
    mintHash,
    explorerUrl,
    attestation,
    apiSignature,
  };
}
