/**
 * Gateway deposit — gasless via EIP-3009 ReceiveWithAuthorization.
 *
 * Flow:
 *   1. Tenant Gateway EOA holds USDC on the source chain (sweepChain
 *      moves it there from the ops DCW).
 *   2. Tenant EOA signs an EIP-3009 ReceiveWithAuthorization off-chain
 *      — zero gas, no approve needed. USDC's EIP-712 domain has chainId
 *      so this signature is normal-EIP-712 (the chainId-less Gateway
 *      DOMAIN_SEPARATOR issue does NOT apply here).
 *   3. Sponsor EOA (Sendero's existing TREASURY_PRIVATE_KEY) submits
 *      `GatewayWallet.depositWithAuthorization` paying chain gas.
 *      Inside the call, GatewayWallet invokes
 *      `USDC.receiveWithAuthorization(...)` which pulls USDC from the
 *      tenant EOA via signature and credits Gateway balance to `from`.
 *   4. Tenant EOA is recorded as Gateway depositor.
 *
 * Net: tenant EOA holds USDC only. Never touches the chain. No gas
 * tokens held. Sweep loop deposits 100% on every inbound (Phase 1
 * policy).
 *
 * Contract source: circlefin/evm-gateway-contracts Deposits.sol
 *   depositWithAuthorization(token, from, value, validAfter,
 *                            validBefore, nonce, v, r, s)
 *
 * Sponsor mode for Phase 1: 'eoa' only. The platform-level
 * TREASURY_PRIVATE_KEY signs the on-chain submit. Phase 5 may add a
 * 'circle-sca' mode where a Circle DCW SCA pays via Gas Station — that
 * removes the gas-management burden on the platform EOA. Adding the
 * mode is forward-compat: the route uses `getGatewayEvmSponsorMode()`.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  hexToSignature,
  http,
  type PrivateKeyAccount,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { GATEWAY_CHAINS, isEvmChain } from './gateway';
import { getOrCreateGatewaySigner } from './gateway-signer';
import { randomBytes } from 'node:crypto';

// ── EIP-3009 wire format ──────────────────────────────────────────────

const EIP3009_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const GATEWAY_WALLET_ABI = [
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

const USDC_ABI = [
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
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Gateway's EVM contract address (same on every EVM testnet — Circle
// uses a single deployment across the testnet domains).
const GATEWAY_WALLET_ADDRESS: Address = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

// ── Sponsor loading ───────────────────────────────────────────────────

/**
 * Load the platform sponsor EOA. Phase 1 reuses TREASURY_PRIVATE_KEY,
 * scoped narrowly to "pays gas for tenant Gateway deposits." This is
 * additive scope on the existing platform key — no new env to manage.
 *
 * Phase 5 considers adding 'circle-sca' sponsor mode where a per-chain
 * Circle DCW SCA pays via Gas Station (removes platform-EOA gas
 * management). Until then, EOA mode is the only path.
 */
function loadSponsorAccount(): PrivateKeyAccount {
  const hex = env.treasuryPrivateKey();
  if (!hex) {
    throw new Error(
      'TREASURY_PRIVATE_KEY required as Gateway sponsor — pays chain gas for ' +
        '`depositWithAuthorization`. The tenant EOA never holds gas; the platform ' +
        'EOA submits on its behalf.'
    );
  }
  const normalized = hex.startsWith('0x') ? hex : `0x${hex}`;
  return privateKeyToAccount(normalized as Hex);
}

// ── Public API ────────────────────────────────────────────────────────

export interface DepositToGatewayArgs {
  tenantId: string;
  /** Source chain key (e.g. 'Arc_Testnet'). Must exist in GATEWAY_CHAINS. */
  chainKey: keyof typeof GATEWAY_CHAINS;
  /** Human-readable USDC amount (e.g. "10" for 10 USDC). */
  amount: string;
  /** auto (webhook-triggered sweep) | manual (UI-triggered) | cron (reaper). */
  triggeredBy?: 'auto' | 'manual' | 'cron';
  /** Idempotency key from upstream — Circle webhook notification.id when
   *  triggered by auto-sweep. Persisted on `GatewayDepositLog.webhookEventId`. */
  webhookEventId?: string;
}

export interface DepositToGatewayResult {
  depositLogId: string;
  depositTxHash: Hex;
  /** True if this was a duplicate webhook delivery — no new tx submitted. */
  alreadyProcessed: boolean;
}

/**
 * Sponsor-paid Gateway deposit using EIP-3009 ReceiveWithAuthorization.
 * Caller guarantees the tenant EOA holds at least `amount` USDC on the
 * source chain (sweepChain enforces this by transferring from ops DCW
 * → tenant EOA before calling here).
 *
 * Idempotent on `webhookEventId` via the partial unique index on
 * `gateway_deposit_logs`. A duplicate Circle webhook (CONFIRMED +
 * COMPLETED for the same notification.id) returns the existing row's
 * tx hash without submitting a new on-chain transaction.
 */
export async function depositToGateway(
  args: DepositToGatewayArgs
): Promise<DepositToGatewayResult> {
  const { tenantId, chainKey, amount, triggeredBy = 'auto', webhookEventId } = args;

  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) throw new Error(`Unknown Gateway chain: ${chainKey}`);
  if (!isEvmChain(chain)) {
    throw new Error(
      `depositToGateway: ${chainKey} is a Solana chain — EIP-3009 deposit ` +
        `path is EVM-only. Route Solana deposits through gateway-sweep's ` +
        `Circle Wallets / Unified Balance path.`
    );
  }

  // Idempotency check — if this webhook already drove a deposit, return
  // the existing row. Critical for Circle's at-least-once delivery +
  // dual CONFIRMED/COMPLETED firing.
  if (webhookEventId) {
    const existing = await prisma.gatewayDepositLog.findUnique({
      where: { webhookEventId },
    });
    if (existing && existing.status === 'confirmed' && existing.depositTxHash) {
      return {
        depositLogId: existing.id,
        depositTxHash: existing.depositTxHash as Hex,
        alreadyProcessed: true,
      };
    }
    if (existing?.depositTxHash) {
      return {
        depositLogId: existing.id,
        depositTxHash: existing.depositTxHash as Hex,
        alreadyProcessed: true,
      };
    }
  }

  const signer = await getOrCreateGatewaySigner(tenantId);
  const sponsor = loadSponsorAccount();

  const publicClient = createPublicClient({
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });

  const usdcAddress = chain.usdc;
  let amountBaseUnits = parseUnits(amount, 6);

  // Guard: tenant EOA must hold the USDC. sweepChain is responsible
  // for staging USDC here before calling depositToGateway. If this
  // fails, sweepChain has a bug.
  //
  // viem's readContract type currently requires authorizationList
  // (EIP-7702 list); we don't use 7702, hence the cast. Same below.
  const balance = (await publicClient.readContract({
    address: usdcAddress,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [signer.address],
  } as never)) as bigint;
  if (balance < amountBaseUnits) {
    throw new Error(
      `Tenant EOA ${signer.address} has ${balance} USDC base units on ${chainKey}, ` +
        `need ${amountBaseUnits}. sweepChain failed to stage USDC before deposit.`
    );
  }
  if (chainKey === 'Arc_Testnet' && balance === amountBaseUnits) {
    // Arc's native-USDC account model rejects clearing an account down
    // to exactly zero ("Cannot clear balance of empty account"). Leave
    // one cent as dust so full-balance sweeps succeed deterministically.
    const dustBaseUnits = 10_000n;
    if (amountBaseUnits <= dustBaseUnits) {
      throw new Error(
        `Tenant EOA ${signer.address} holds only ${amountBaseUnits} USDC base units on ` +
          `${chainKey}; leaving Arc dust would deposit zero.`
      );
    }
    amountBaseUnits -= dustBaseUnits;
  }

  // Read USDC's EIP-712 domain name + version from the token. Testnet
  // Circle USDC uses name="USDC" version="2" on most chains but
  // fetching is safer than hardcoding (Sepolia deployments differ).
  const [tokenName, tokenVersion] = await Promise.all([
    publicClient.readContract({
      address: usdcAddress,
      abi: USDC_ABI,
      functionName: 'name',
    } as never) as Promise<string>,
    publicClient.readContract({
      address: usdcAddress,
      abi: USDC_ABI,
      functionName: 'version',
    } as never) as Promise<string>,
  ]);

  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = 0n;
  const validBefore = BigInt(nowSec + 60 * 30); // 30-minute auth window
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;

  const message = {
    from: signer.address,
    to: GATEWAY_WALLET_ADDRESS,
    value: amountBaseUnits,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await signer.account.signTypedData({
    types: EIP3009_TYPES,
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId: chain.viemChain.id,
      verifyingContract: usdcAddress,
    },
    primaryType: 'ReceiveWithAuthorization',
    message,
  });

  const { r, s, v } = hexToSignature(signature);

  // Persist the pending log row. Idempotent on webhookEventId — if a
  // duplicate webhook somehow gets past the early-return above (race
  // between two concurrent dispatches), the unique index turns the
  // second insert into an upsert that no-ops cleanly.
  const logRow = await prisma.gatewayDepositLog.upsert({
    where: webhookEventId ? { webhookEventId } : { id: '00000000-0000-0000-0000-000000000000' },
    create: {
      tenantId,
      chain: chain.kitName,
      domain: chain.domain,
      amountMicroUsdc: amountBaseUnits,
      status: 'pending',
      triggeredBy,
      webhookEventId: webhookEventId ?? null,
    },
    update: {}, // no-op for idempotent path
  });

  const walletClient = createWalletClient({
    account: sponsor,
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });

  let depositTxHash: Hex | null = null;
  try {
    depositTxHash = await walletClient.writeContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'depositWithAuthorization',
      args: [
        usdcAddress,
        signer.address,
        amountBaseUnits,
        validAfter,
        validBefore,
        nonce,
        Number(v),
        r,
        s,
      ],
      account: sponsor,
      chain: chain.viemChain,
    });
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { depositTxHash, status: 'pending' },
    });
    await publicClient.waitForTransactionReceipt({ hash: depositTxHash });
  } catch (err) {
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: {
        status: depositTxHash ? 'pending' : 'failed',
        ...(depositTxHash ? { depositTxHash } : {}),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  await prisma.gatewayDepositLog.update({
    where: { id: logRow.id },
    data: {
      depositTxHash,
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });

  return {
    depositLogId: logRow.id,
    depositTxHash: depositTxHash as Hex,
    alreadyProcessed: false,
  };
}
