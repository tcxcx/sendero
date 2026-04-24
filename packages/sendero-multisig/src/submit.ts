/**
 * Submit a signed userOp to an ERC-4337 v0.7 bundler.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 */

import type { Hex } from 'viem';

import { MODULAR_WALLET_ENTRY_POINT_V07 } from './constants';

export interface SubmitUserOpParams {
  bundlerRpcUrl: string;
  userOp: Record<string, unknown>;
}

export interface SubmitUserOpResult {
  userOpHash: Hex;
  success: boolean;
}

/**
 * Submit a signed userOp via `eth_sendUserOperation`.
 *
 * EntryPoint v0.7 — see `MODULAR_WALLET_ENTRY_POINT_V07` in ./constants.
 */
export async function submitUserOp(params: SubmitUserOpParams): Promise<SubmitUserOpResult> {
  const { bundlerRpcUrl, userOp } = params;

  const response = await fetch(bundlerRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendUserOperation',
      params: [userOp, MODULAR_WALLET_ENTRY_POINT_V07],
    }),
  });

  const result = (await response.json()) as {
    result?: Hex;
    error?: { message?: string };
  };

  if (result.error) {
    throw new Error(`Bundler error: ${result.error.message ?? JSON.stringify(result.error)}`);
  }

  if (!result.result) {
    throw new Error('Bundler returned no result');
  }

  return {
    userOpHash: result.result,
    success: true,
  };
}
