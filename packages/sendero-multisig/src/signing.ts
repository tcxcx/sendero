/**
 * ERC-4337 UserOp construction and weighted multisig signature packing.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * desk-v1 in turn ported this from Circle's msca-wallet-recovery reference:
 * https://github.com/nichanank/msca-wallet-recovery
 *
 * Core operations:
 *  - getUserOpHash: compute the ERC-4337 userOp hash via on-chain EntryPoint
 *  - getPartialUserOp: build initial userOp with nonce and zero gas estimates
 *  - estimateUserOp: estimate gas with padded dummy signatures for N signers
 *  - buildMultiSigUserOp: pack sorted signatures with v-byte adjustment
 *  - encodeCallData: encode execute/executeBatch for MSCA account
 *  - getERC20TransferCallData: encode ERC-20 transfer function data
 *
 * SECURITY: The signature packing logic (sort by address, v-byte +32 adjustment
 * for actual gas payer) is critical for ERC-4337 compliance. Do not modify
 * without understanding the EntryPoint signature validation flow.
 *
 * Uses viem exclusively — no ethers dependency.
 */

import {
  type Address,
  type Chain,
  concatHex,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  hexToBigInt,
  http,
  pad,
  toHex,
} from 'viem';

import { applyUserOperationFeeFloor, MODULAR_WALLET_ENTRY_POINT_V07 } from './constants';

/** ERC-4337 v0.7 UserOperation */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/** ERC-4337 v0.7 EntryPoint address (canonical deployment) */
const ENTRYPOINT_ADDRESS_V07 = MODULAR_WALLET_ENTRY_POINT_V07;

/**
 * Minimal EntryPoint ABI — only the getUserOpHash view function.
 * The packed userOp struct matches ERC-4337 v0.7 format.
 */
const ENTRY_POINT_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
        name: 'userOp',
        type: 'tuple',
      },
    ],
    name: 'getUserOpHash',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * MSCA account execute ABI — single call execution.
 * Used by encodeCallData for single-target operations.
 */
const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

/**
 * MSCA account executeBatch ABI — batch call execution.
 * Used by encodeCallData for multi-target atomic operations.
 */
const EXECUTE_BATCH_ABI = [
  {
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes[]' }],
  },
] as const;

/** Standard ERC-20 transfer ABI */
const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Signer's contribution to a multisig signature */
export interface SignerSignature {
  /** Signer's EOA or smart account address */
  signer: Address;
  /** Raw ECDSA or WebAuthn signature */
  signature: string;
  /**
   * UserOp signature type byte:
   * - "0x00" = EOA (contract owner)
   * - "0x02" = passkey (WebAuthn)
   * Defaults to "0x00" (EOA).
   */
  userOpSigType?: string;
}

/**
 * Compute the ERC-4337 userOp hash via on-chain EntryPoint call.
 *
 * Uses a direct contract read to the canonical EntryPoint v0.7 so the hash
 * matches what the EntryPoint will verify during validation.
 */
export async function getUserOpHash(params: {
  chain: Chain;
  bundlerRPCUrl: string;
  userOp: PackedUserOperation;
  entryPoint?: Address;
}): Promise<Hex> {
  const { chain, bundlerRPCUrl, userOp, entryPoint = ENTRYPOINT_ADDRESS_V07 } = params;

  const publicClient = createPublicClient({
    chain,
    transport: http(bundlerRPCUrl),
  });

  const hash = await publicClient.readContract({
    address: entryPoint,
    abi: ENTRY_POINT_ABI,
    functionName: 'getUserOpHash',
    authorizationList: undefined,
    args: [
      {
        sender: userOp.sender,
        nonce: userOp.nonce,
        initCode: userOp.initCode,
        callData: userOp.callData,
        accountGasLimits: userOp.accountGasLimits,
        preVerificationGas: userOp.preVerificationGas,
        gasFees: userOp.gasFees,
        paymasterAndData: userOp.paymasterAndData,
        signature: userOp.signature,
      },
    ],
  });

  return hash as Hex;
}

/**
 * Build a partial UserOperation with the account nonce and zero gas fields.
 *
 * Fetches the current nonce from the EntryPoint via the bundler, then
 * constructs a userOp skeleton ready for gas estimation.
 */
export async function getPartialUserOp(params: {
  chain: Chain;
  bundlerRPCUrl: string;
  senderAddress: Address;
  callData: Hex;
}): Promise<PackedUserOperation> {
  const { chain, bundlerRPCUrl, senderAddress, callData } = params;

  const publicClient = createPublicClient({
    chain,
    transport: http(bundlerRPCUrl),
  });

  // Fetch nonce from EntryPoint via bundler RPC — default validator key is 0.
  const nonceKey = BigInt(0);
  const nonce = await publicClient.readContract({
    address: ENTRYPOINT_ADDRESS_V07,
    abi: [
      {
        type: 'function',
        name: 'getNonce',
        stateMutability: 'view',
        inputs: [
          { name: 'sender', type: 'address' },
          { name: 'key', type: 'uint192' },
        ],
        outputs: [{ name: 'nonce', type: 'uint256' }],
      },
    ] as const,
    functionName: 'getNonce',
    authorizationList: undefined,
    args: [senderAddress, nonceKey],
  });

  return {
    sender: senderAddress,
    nonce: nonce as bigint,
    initCode: '0x',
    callData,
    accountGasLimits: pad('0x', { size: 32 }),
    preVerificationGas: BigInt(0),
    gasFees: pad('0x', { size: 32 }),
    paymasterAndData: '0x',
    signature: '0x',
  };
}

/**
 * Estimate gas for a UserOperation with dummy signatures padded for N signers.
 *
 * The dummy signature matches the byte length the real multisig signature will
 * have so the bundler's gas estimate is accurate. Per-signer layout:
 *  - 1 byte: signature type (0x00 = EOA)
 *  - 20 bytes: signer address (padded)
 *  - 65 bytes: dummy ECDSA signature (all 0xFF)
 */
export async function estimateUserOp(params: {
  chain: Chain;
  bundlerRPCUrl: string;
  userOp: PackedUserOperation;
  numSigners: number;
  gasFeesMultiplier?: number;
}): Promise<PackedUserOperation> {
  const { chain, bundlerRPCUrl, userOp, numSigners, gasFeesMultiplier = 2 } = params;

  const dummySigBytes: Hex[] = [];
  for (let i = 0; i < numSigners; i++) {
    const sigType = '0x00' as Hex;
    const dummyAddr = pad(toHex(i + 1), { size: 20 });
    const dummySig = ('0x' + 'ff'.repeat(65)) as Hex;
    dummySigBytes.push(concatHex([sigType, dummyAddr, dummySig]));
  }
  const paddedSignature = concatHex(dummySigBytes);

  const userOpWithDummySig: PackedUserOperation = {
    ...userOp,
    signature: paddedSignature,
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(bundlerRPCUrl),
  });

  // eth_estimateUserOperationGas is a JSON-RPC method exposed by the bundler.
  const gasEstimate = (await publicClient.request({
    method: 'eth_estimateUserOperationGas' as never,
    params: [
      {
        sender: userOpWithDummySig.sender,
        nonce: toHex(userOpWithDummySig.nonce),
        initCode: userOpWithDummySig.initCode,
        callData: userOpWithDummySig.callData,
        signature: userOpWithDummySig.signature,
      },
      ENTRYPOINT_ADDRESS_V07,
    ] as never,
  })) as {
    preVerificationGas: Hex;
    verificationGasLimit: Hex;
    callGasLimit: Hex;
    maxFeePerGas?: Hex;
    maxPriorityFeePerGas?: Hex;
  };

  const preVerificationGas = hexToBigInt(gasEstimate.preVerificationGas);
  const verificationGasLimit = hexToBigInt(gasEstimate.verificationGasLimit);
  const callGasLimit = hexToBigInt(gasEstimate.callGasLimit);

  // Pack accountGasLimits: upper 128 = verificationGasLimit, lower 128 = callGasLimit.
  const accountGasLimits = concatHex([
    pad(toHex(verificationGasLimit), { size: 16 }),
    pad(toHex(callGasLimit), { size: 16 }),
  ]) as Hex;

  const feeData = (await publicClient.request({
    method: 'eth_maxPriorityFeePerGas' as never,
    params: [] as never,
  })) as Hex;
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const baseFee = block.baseFeePerGas ?? BigInt(0);
  const estimatedPriorityFeePerGas = hexToBigInt(feeData);
  const { maxPriorityFeePerGas, maxFeePerGas } = applyUserOperationFeeFloor({
    chainId: chain.id,
    maxPriorityFeePerGas: estimatedPriorityFeePerGas,
    maxFeePerGas: baseFee * BigInt(gasFeesMultiplier) + estimatedPriorityFeePerGas,
  });

  // Pack gasFees: upper 128 = maxPriorityFeePerGas, lower 128 = maxFeePerGas.
  const gasFees = concatHex([
    pad(toHex(maxPriorityFeePerGas), { size: 16 }),
    pad(toHex(maxFeePerGas), { size: 16 }),
  ]) as Hex;

  return {
    ...userOp,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    signature: paddedSignature, // Will be replaced by real signatures
  };
}

/**
 * Pack sorted multisig signatures into a single userOp signature field.
 *
 * Security-critical — this matches the WeightedWebauthnMultisigPlugin's
 * decoding path:
 *
 * 1. Sort signers by address (ascending, case-insensitive) for gas-efficient
 *    duplicate detection.
 * 2. LAST signer is the "actual gas payer" — their ECDSA v-byte gets +32 to
 *    signal that to the EntryPoint.
 * 3. Per-signer layout: 1 byte sigType + 20 bytes signer + raw signature.
 */
export async function buildMultiSigUserOp(params: {
  userOp: PackedUserOperation;
  signatures: SignerSignature[];
}): Promise<PackedUserOperation> {
  const { userOp, signatures } = params;

  if (signatures.length === 0) {
    throw new Error('At least one signature is required');
  }

  const sorted = [...signatures].sort((a, b) =>
    a.signer.toLowerCase().localeCompare(b.signer.toLowerCase())
  );

  const packedParts: Hex[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const sigType = (entry.userOpSigType ?? '0x00') as Hex;
    const signerAddr = entry.signer;

    let rawSig = entry.signature;
    if (!rawSig.startsWith('0x')) {
      rawSig = '0x' + rawSig;
    }

    // For the last signer (highest address), +32 to the v-byte of the 65-byte
    // ECDSA signature. Marks them as the "actual gas payer" per the plugin.
    if (i === sorted.length - 1 && sigType === '0x00') {
      const sigBytes = rawSig as Hex;
      if (sigBytes.length >= 132) {
        // 0x + 128 chars r+s + 2 chars v
        const rsPart = sigBytes.slice(0, 130);
        const vByte = parseInt(sigBytes.slice(130, 132), 16);
        const adjustedV = vByte + 32;
        rawSig = rsPart + adjustedV.toString(16).padStart(2, '0');
      }
    }

    packedParts.push(concatHex([sigType, signerAddr, rawSig as Hex]));
  }

  const packedSignature = concatHex(packedParts);

  return {
    ...userOp,
    signature: packedSignature,
  };
}

/**
 * Encode call data for MSCA account execution (execute or executeBatch).
 *
 * Batch operations are atomic — all succeed or all revert.
 */
export function encodeCallData(
  args:
    | { to: Address; value: number | bigint; data: Hex }
    | Array<{ to: Address; value: number | bigint; data: Hex }>
): Hex {
  if (Array.isArray(args)) {
    return encodeFunctionData({
      abi: EXECUTE_BATCH_ABI,
      functionName: 'executeBatch',
      args: [
        args.map(call => ({
          target: call.to,
          value: BigInt(call.value),
          data: call.data,
        })),
      ],
    });
  }

  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [args.to, BigInt(args.value), args.data],
  });
}

/**
 * Encode ERC-20 `transfer(address,uint256)` call data, ready to be wrapped
 * in `encodeCallData` for userOp submission.
 */
export function getERC20TransferCallData(params: { toAddress: Address; amount: bigint }): Hex {
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [params.toAddress, params.amount],
  });
}
