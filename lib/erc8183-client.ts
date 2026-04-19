/**
 * Encoders for the ERC-8183 / ERC-8004 calls that the user's MSCA signs.
 *
 * Each helper returns `{ to, data, value }` shaped for Modular Wallets
 * `sendUserOperation({ calls })`. Shared between the frontend userOp
 * builder and the backend orchestrator (which may parse outputs from the
 * same ABIs).
 */

import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
} from 'viem';

export const AGENTIC_COMMERCE_ADDRESS =
  '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;
export const ARC_USDC_ADDRESS =
  '0x3600000000000000000000000000000000000000' as const;
export const REPUTATION_REGISTRY =
  '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

// ── ABI fragments ───────────────────────────────────────────────────────

const USDC_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

const AGENTIC_COMMERCE_ABI = parseAbi([
  'function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)',
  'function setBudget(uint256 jobId, uint256 amount, bytes data)',
  'function fund(uint256 jobId, bytes data)',
  'function submit(uint256 jobId, bytes32 deliverableHash, bytes data)',
  'function complete(uint256 jobId, bytes32 reasonHash, bytes data)',
]);

const REPUTATION_ABI = parseAbi([
  'function giveFeedback(uint256 subject, int128 score, uint8 status, string tag, string title, string description, string uri, bytes32 feedbackHash)',
]);

export const JOB_CREATED_EVENT = parseAbiItem(
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
);

// ── Call shape ──────────────────────────────────────────────────────────

export interface EncodedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

const ZERO_HOOK = '0x0000000000000000000000000000000000000000' as const;

// ── Encoders ────────────────────────────────────────────────────────────

export function encodeApproveUsdc(
  spender: Address,
  amount: bigint,
): EncodedCall {
  return {
    to: ARC_USDC_ADDRESS,
    data: encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'approve',
      args: [spender, amount],
    }),
    value: 0n,
  };
}

/**
 * ERC-20 transfer of USDC from the MSCA (msg.sender in the userOp) to
 * `recipient`. No allowance needed because the caller owns the funds.
 */
export function encodeUsdcTransfer(
  recipient: Address,
  amount: bigint,
): EncodedCall {
  return {
    to: ARC_USDC_ADDRESS,
    data: encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [recipient, amount],
    }),
    value: 0n,
  };
}

export interface CreateJobArgs {
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
  description: string;
  hook?: Address;
}

export function encodeCreateJob(args: CreateJobArgs): EncodedCall {
  return {
    to: AGENTIC_COMMERCE_ADDRESS,
    data: encodeFunctionData({
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'createJob',
      args: [
        args.provider,
        args.evaluator,
        args.expiredAt,
        args.description,
        args.hook ?? ZERO_HOOK,
      ],
    }),
    value: 0n,
  };
}

export function encodeFund(jobId: bigint): EncodedCall {
  return {
    to: AGENTIC_COMMERCE_ADDRESS,
    data: encodeFunctionData({
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'fund',
      args: [jobId, '0x'],
    }),
    value: 0n,
  };
}

export function encodeComplete(
  jobId: bigint,
  reasonHash: Hex,
): EncodedCall {
  return {
    to: AGENTIC_COMMERCE_ADDRESS,
    data: encodeFunctionData({
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'complete',
      args: [jobId, reasonHash, '0x'],
    }),
    value: 0n,
  };
}

export interface GiveFeedbackArgs {
  agentId: bigint;
  /** 0-100 */
  score: number;
  tag: string;
}

export function encodeGiveFeedback(args: GiveFeedbackArgs): EncodedCall {
  const feedbackHash = keccak256(toHex(args.tag));
  return {
    to: REPUTATION_REGISTRY,
    data: encodeFunctionData({
      abi: REPUTATION_ABI,
      functionName: 'giveFeedback',
      args: [
        args.agentId,
        BigInt(args.score) as any,
        0, // status = 0 (positive)
        args.tag,
        '',
        '',
        '',
        feedbackHash,
      ],
    }),
    value: 0n,
  };
}

// ── Utilities ───────────────────────────────────────────────────────────

export function hashPnr(pnr: string): Hex {
  return keccak256(toHex(pnr));
}

export function hashReason(reason: string): Hex {
  return keccak256(toHex(reason));
}

/**
 * USDC decimal → uint256. USDC is 6 decimals on Arc Testnet.
 */
export function toUsdcUnits(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(fracPadded || '0');
}
