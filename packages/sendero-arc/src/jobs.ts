/**
 * ERC-8183 Agentic Commerce client.
 *
 * Job lifecycle: Open → Funded → Submitted → Completed (or Rejected/Expired).
 * All txs go through Circle Developer-Controlled Wallets (no private keys).
 *
 * Contract: https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583
 * Spec: https://eips.ethereum.org/EIPS/eip-8183
 */

import { decodeEventLog, keccak256, toHex, type Address, type Hex } from 'viem';
import { getCircle } from '@sendero/circle/wallets';
import { getArcClient } from './chain';

export const AGENTIC_COMMERCE_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;
export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

/**
 * Minimal ABI for parsing `JobCreated` event + reading `getJob` view.
 * Function signatures are passed as strings to Circle DCW (see execute() helper).
 */
const AGENTIC_COMMERCE_ABI = [
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { indexed: true, name: 'jobId', type: 'uint256' },
      { indexed: true, name: 'client', type: 'address' },
      { indexed: true, name: 'provider', type: 'address' },
      { indexed: false, name: 'evaluator', type: 'address' },
      { indexed: false, name: 'expiredAt', type: 'uint256' },
      { indexed: false, name: 'hook', type: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'client', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'evaluator', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'budget', type: 'uint256' },
          { name: 'expiredAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'hook', type: 'address' },
        ],
      },
    ],
  },
] as const;

export const JOB_STATUS = [
  'Open',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired',
] as const;

export type JobStatus = (typeof JOB_STATUS)[number];

export interface TxResult {
  txId: string;
  txHash: Hex;
  blockNumber?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Poll Circle DCW until a transaction lands on-chain.
 * Returns the on-chain tx hash when state === COMPLETE.
 */
async function waitForCircleTx(txId: string, label: string, timeoutMs = 120_000): Promise<Hex> {
  const circle = getCircle();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tx = await circle.getTransaction({ id: txId });
    const data: any = tx.data?.transaction;
    if (data?.state === 'COMPLETE' && data.txHash) {
      return data.txHash as Hex;
    }
    if (data?.state === 'FAILED') {
      throw new Error(`Circle tx "${label}" failed on-chain (id=${txId})`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Circle tx "${label}" timed out after ${timeoutMs}ms (id=${txId})`);
}

/**
 * Single helper to submit a contract execution via Circle DCW and wait for confirmation.
 */
async function execContract(params: {
  walletAddress: string;
  contractAddress: Address;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  label: string;
}): Promise<TxResult> {
  const circle = getCircle();
  const response = await circle.createContractExecutionTransaction({
    walletAddress: params.walletAddress,
    blockchain: 'ARC-TESTNET' as any,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters as any,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' as any } },
  } as any);
  const txId = (response.data as any)?.id;
  if (!txId) throw new Error(`Circle returned no tx id for ${params.label}`);
  const txHash = await waitForCircleTx(txId, params.label);
  return { txId, txHash };
}

// ─── ERC-8183 Operations ─────────────────────────────────────────────────────

export interface CreateJobParams {
  clientWalletAddress: string;
  providerAddress: Address;
  evaluatorAddress: Address;
  expiredAt: bigint;
  description: string;
  hookAddress?: Address;
}

/**
 * 1. createJob — client creates the job in `Open` state.
 * Returns the parsed jobId from the JobCreated event.
 */
export async function createJob(params: CreateJobParams): Promise<{
  jobId: bigint;
  txHash: Hex;
}> {
  const hook = params.hookAddress ?? '0x0000000000000000000000000000000000000000';
  const result = await execContract({
    walletAddress: params.clientWalletAddress,
    contractAddress: AGENTIC_COMMERCE_ADDRESS,
    abiFunctionSignature: 'createJob(address,address,uint256,string,address)',
    abiParameters: [
      params.providerAddress,
      params.evaluatorAddress,
      params.expiredAt.toString(),
      params.description,
      hook,
    ],
    label: 'createJob',
  });

  // Parse JobCreated event from the receipt
  const publicClient = getArcClient();
  const receipt = await publicClient.getTransactionReceipt({ hash: result.txHash });

  for (const log of receipt.logs) {
    try {
      const logAny = log as any;
      const decoded = decodeEventLog({
        abi: AGENTIC_COMMERCE_ABI,
        data: logAny.data,
        topics: logAny.topics,
      }) as any;
      if (decoded.eventName === 'JobCreated') {
        return { jobId: (decoded.args as any).jobId as bigint, txHash: result.txHash };
      }
    } catch {
      continue;
    }
  }
  throw new Error(`No JobCreated event found in tx ${result.txHash}`);
}

/**
 * 2. setBudget — provider pins the job price.
 */
export async function setBudget(params: {
  providerWalletAddress: string;
  jobId: bigint;
  amount: bigint;
}): Promise<TxResult> {
  return execContract({
    walletAddress: params.providerWalletAddress,
    contractAddress: AGENTIC_COMMERCE_ADDRESS,
    abiFunctionSignature: 'setBudget(uint256,uint256,bytes)',
    abiParameters: [params.jobId.toString(), params.amount.toString(), '0x'],
    label: 'setBudget',
  });
}

/**
 * 3. approve USDC — client allows the AgenticCommerce contract to pull the budget.
 * Uses Arc Testnet USDC at 0x3600... (native gas token).
 */
export async function approveUsdc(params: {
  clientWalletAddress: string;
  amount: bigint;
}): Promise<TxResult> {
  return execContract({
    walletAddress: params.clientWalletAddress,
    contractAddress: ARC_USDC_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [AGENTIC_COMMERCE_ADDRESS, params.amount.toString()],
    label: 'approveUsdc',
  });
}

/**
 * 4. fund — moves escrow USDC into the contract. Job transitions Open → Funded.
 */
export async function fundJob(params: {
  clientWalletAddress: string;
  jobId: bigint;
}): Promise<TxResult> {
  return execContract({
    walletAddress: params.clientWalletAddress,
    contractAddress: AGENTIC_COMMERCE_ADDRESS,
    abiFunctionSignature: 'fund(uint256,bytes)',
    abiParameters: [params.jobId.toString(), '0x'],
    label: 'fund',
  });
}

/**
 * 5. submit — provider submits deliverable hash. Job transitions Funded → Submitted.
 * Note: quickstart calls this `submit` (not `submitDeliverable`).
 */
export async function submitDeliverable(params: {
  providerWalletAddress: string;
  jobId: bigint;
  deliverableHash: Hex;
}): Promise<TxResult> {
  return execContract({
    walletAddress: params.providerWalletAddress,
    contractAddress: AGENTIC_COMMERCE_ADDRESS,
    abiFunctionSignature: 'submit(uint256,bytes32,bytes)',
    abiParameters: [params.jobId.toString(), params.deliverableHash, '0x'],
    label: 'submit',
  });
}

/**
 * 6. complete — evaluator completes the job. Job transitions Submitted → Completed.
 * Escrow USDC is released to the provider.
 */
export async function completeJob(params: {
  evaluatorWalletAddress: string;
  jobId: bigint;
  reasonHash: Hex;
}): Promise<TxResult> {
  return execContract({
    walletAddress: params.evaluatorWalletAddress,
    contractAddress: AGENTIC_COMMERCE_ADDRESS,
    abiFunctionSignature: 'complete(uint256,bytes32,bytes)',
    abiParameters: [params.jobId.toString(), params.reasonHash, '0x'],
    label: 'complete',
  });
}

/**
 * Read-only: fetch the current state of a job.
 */
export async function getJob(jobId: bigint): Promise<{
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: JobStatus;
  hook: Address;
}> {
  const publicClient = getArcClient();
  const raw = (await publicClient.readContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [jobId],
  } as any)) as any;

  return {
    id: raw.id,
    client: raw.client,
    provider: raw.provider,
    evaluator: raw.evaluator,
    description: raw.description,
    budget: raw.budget,
    expiredAt: raw.expiredAt,
    status: JOB_STATUS[Number(raw.status)] ?? 'Open',
    hook: raw.hook,
  };
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Compute deliverable hash from a PNR string (or any arbitrary deliverable).
 */
export function hashDeliverable(value: string): Hex {
  return keccak256(toHex(value));
}

/**
 * Convert a USDC decimal amount (e.g. "1842.00") to the raw uint256 the
 * contract expects. USDC has 6 decimals on Arc.
 */
export function toUsdcUnits(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded || '0');
}
