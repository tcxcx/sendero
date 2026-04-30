/**
 * ERC-20 Transfer UserOp Builders for MSCA Wallets.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 *
 * Focused builders for constructing ERC-20 transfer calldata that can be
 * submitted as userOps through the multisig signing flow. Supports:
 *
 *  - Single transfers: one recipient, wrapped in execute()
 *  - Transfers with fee: recipient + fee recipient, batched via executeBatch()
 *
 * Uses lightweight manual ABI encoding (same approach as userop-builder.ts
 * internals) to keep the transfer builders dependency-free.
 */

import type { Address } from 'viem';

/** Parameters for building an ERC-20 transfer call */
export interface TransferParams {
  /** ERC-20 token contract address */
  tokenAddress: Address;
  /** Recipient address */
  to: Address;
  /** Transfer amount in token minor units (e.g., 6 decimals for USDC) */
  amount: bigint;
}

/** Parameters for building a transfer with a separate fee payment */
export interface TransferWithFeeParams extends TransferParams {
  /** Address that receives the fee */
  feeRecipient: Address;
  /** Fee amount in token minor units */
  feeAmount: bigint;
}

/** Intent returned by the two-round multisig transfer flow (propose → approve → execute) */
export interface MultisigTransferIntent {
  callData: Address;
  tokenAddress: Address;
  to: Address;
  amount: bigint;
  feeRecipient?: Address;
  feeAmount?: bigint;
  isBatch: boolean;
}

// ---------------------------------------------------------------------------
// Function Selectors
// ---------------------------------------------------------------------------

/** `transfer(address,uint256)` → 0xa9059cbb */
const TRANSFER_SELECTOR = '0xa9059cbb';

/** `execute(address,uint256,bytes)` → 0xb61d27f6 */
const EXECUTE_SELECTOR = '0xb61d27f6';

/** `executeBatch((address,uint256,bytes)[])` → 0x34fcd5be */
const EXECUTE_BATCH_SELECTOR = '0x34fcd5be';

// ---------------------------------------------------------------------------
// ABI encoding helpers (manual — avoids viem's ox peer in test envs)
// ---------------------------------------------------------------------------

function encodeAddress(addr: string): string {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
  return clean.toLowerCase().padStart(64, '0');
}

function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function encodeBytesData(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const byteLen = clean.length / 2;
  const lenWord = encodeUint256(BigInt(byteLen));
  const paddedData = clean.padEnd(Math.ceil(clean.length / 64) * 64, '0');
  return lenWord + paddedData;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Encode an ERC-20 `transfer(address,uint256)` call (raw calldata). */
export function buildTransferCallData(params: TransferParams): Address {
  const data = TRANSFER_SELECTOR.slice(2) + encodeAddress(params.to) + encodeUint256(params.amount);
  return `0x${data}` as Address;
}

/** Build a single ERC-20 transfer wrapped in MSCA `execute()`. */
export function buildSingleTransferExecuteData(params: TransferParams): Address {
  const transferData = buildTransferCallData(params);
  const innerHex = transferData.slice(2);

  const targetWord = encodeAddress(params.tokenAddress);
  const valueWord = encodeUint256(BigInt(0));
  // Offset to bytes data = 3 words = 96 = 0x60
  const dataOffset = encodeUint256(BigInt(96));
  const bytesEncoded = encodeBytesData(innerHex);

  const encoded = EXECUTE_SELECTOR.slice(2) + targetWord + valueWord + dataOffset + bytesEncoded;
  return `0x${encoded}` as Address;
}

/**
 * Build a transfer with optional fee, using execute or executeBatch.
 *
 * Zero fee → single execute. Non-zero fee → atomic executeBatch with
 * (transfer, fee-transfer).
 */
export function buildTransferWithFeeExecuteData(params: TransferWithFeeParams): Address {
  if (params.feeAmount === BigInt(0)) {
    return buildSingleTransferExecuteData(params);
  }

  const transferData = buildTransferCallData(params);
  const feeData = buildTransferCallData({
    tokenAddress: params.tokenAddress,
    to: params.feeRecipient,
    amount: params.feeAmount,
  });

  return encodeExecuteBatch([
    { target: params.tokenAddress, value: BigInt(0), data: transferData },
    { target: params.tokenAddress, value: BigInt(0), data: feeData },
  ]);
}

/**
 * Encode `executeBatch((address,uint256,bytes)[])` call data.
 *
 * Layout:
 *  - selector (4 bytes)
 *  - offset to tuple array (32 bytes) = 0x20
 *  - array length (32 bytes)
 *  - for each element: offset to that tuple (32 bytes each)
 *  - for each element: target (32) + value (32) + bytes offset (32) + bytes data
 */
function encodeExecuteBatch(
  calls: Array<{ target: Address; value: bigint; data: Address }>
): Address {
  const n = calls.length;

  const arrayOffset = encodeUint256(BigInt(32));
  const arrayLen = encodeUint256(BigInt(n));

  const tupleEncodings: string[] = [];
  for (const call of calls) {
    const innerHex = call.data.slice(2);
    const targetWord = encodeAddress(call.target);
    const valueWord = encodeUint256(call.value);
    const bytesOffset = encodeUint256(BigInt(96));
    const bytesEncoded = encodeBytesData(innerHex);
    tupleEncodings.push(targetWord + valueWord + bytesOffset + bytesEncoded);
  }

  const offsetAreaSize = n * 32;
  const tupleOffsets: string[] = [];
  let currentOffset = offsetAreaSize;
  for (const enc of tupleEncodings) {
    tupleOffsets.push(encodeUint256(BigInt(currentOffset)));
    currentOffset += enc.length / 2;
  }

  const encoded =
    EXECUTE_BATCH_SELECTOR.slice(2) +
    arrayOffset +
    arrayLen +
    tupleOffsets.join('') +
    tupleEncodings.join('');

  return `0x${encoded}` as Address;
}

/** Build a MultisigTransferIntent for the two-round multisig flow. */
export function buildTransferIntent(params: TransferWithFeeParams): MultisigTransferIntent {
  const hasFee = params.feeAmount > BigInt(0);
  const callData = hasFee
    ? buildTransferWithFeeExecuteData(params)
    : buildSingleTransferExecuteData(params);

  return {
    callData,
    tokenAddress: params.tokenAddress,
    to: params.to,
    amount: params.amount,
    feeRecipient: hasFee ? params.feeRecipient : undefined,
    feeAmount: hasFee ? params.feeAmount : undefined,
    isBatch: hasFee,
  };
}
