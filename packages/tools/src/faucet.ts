/**
 * Circle testnet faucet helper.
 *
 * Ports the desk-v1 pattern for programmatic USDC/EURC drips against
 * Circle's faucet API. Drips 20 units of the requested token per call.
 * Used by smoke scripts to fund test treasuries without manual UI clicks.
 *
 * Circle faucet endpoint:
 *   POST https://api.circle.com/v1/faucet/drips
 *   Authorization: Bearer <CIRCLE_API_KEY>
 *   body: { address, blockchain, usdc?: true, eurc?: true }
 *
 * Rate-limited by Circle — retries should back off. Returns a simple
 * { ok, status, message } envelope so callers can script retries or
 * surface failures to humans.
 */

import type { ToolDef } from './types';
import { z } from 'zod';

export type FaucetChain = 'ARC-TESTNET' | 'ETH-SEPOLIA' | 'AVAX-FUJI' | 'MATIC-AMOY';
export type FaucetToken = 'USDC' | 'EURC';

export interface FaucetDripArgs {
  address: string;
  blockchain?: FaucetChain;
  token?: FaucetToken;
  /** Override the Circle API key env. Useful for isolated scripts. */
  apiKey?: string;
}

export interface FaucetDripResult {
  ok: boolean;
  status: number;
  message: string;
  address: string;
  blockchain: FaucetChain;
  token: FaucetToken;
}

const FAUCET_URL = 'https://api.circle.com/v1/faucet/drips';

export async function requestFaucetDrip(args: FaucetDripArgs): Promise<FaucetDripResult> {
  const blockchain = args.blockchain ?? 'ARC-TESTNET';
  const token = args.token ?? 'USDC';
  const apiKey = args.apiKey ?? process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      message: 'CIRCLE_API_KEY env var not set',
      address: args.address,
      blockchain,
      token,
    };
  }

  const body: Record<string, unknown> = {
    address: args.address,
    blockchain,
  };
  if (token === 'USDC') body.usdc = true;
  else if (token === 'EURC') body.eurc = true;

  const res = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  let message = `${res.status} ${res.statusText}`;
  try {
    const text = await res.text();
    if (text) message = text;
  } catch {
    // ignore — stick with status line
  }

  return {
    ok: res.ok,
    status: res.status,
    message,
    address: args.address,
    blockchain,
    token,
  };
}

// ─── MCP tool wrapper ────────────────────────────────────────────────

const faucetInput = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address'),
  blockchain: z
    .enum(['ARC-TESTNET', 'ETH-SEPOLIA', 'AVAX-FUJI', 'MATIC-AMOY'])
    .default('ARC-TESTNET'),
  token: z.enum(['USDC', 'EURC']).default('USDC'),
});

export const faucetDripTool: ToolDef = {
  name: 'faucet_drip',
  description:
    'Drip 20 testnet units of USDC or EURC from the Circle faucet to any address on a supported testnet (ARC-TESTNET default). Rate-limited upstream by Circle. Returns ok/status/message envelope.',
  inputSchema: faucetInput,
  jsonSchema: {
    type: 'object',
    required: ['address'],
    properties: {
      address: { type: 'string', description: 'Destination EOA / MSCA / contract address.' },
      blockchain: {
        type: 'string',
        enum: ['ARC-TESTNET', 'ETH-SEPOLIA', 'AVAX-FUJI', 'MATIC-AMOY'],
        default: 'ARC-TESTNET',
      },
      token: { type: 'string', enum: ['USDC', 'EURC'], default: 'USDC' },
    },
  },
  async handler(input) {
    const parsed = faucetInput.parse(input);
    return await requestFaucetDrip(parsed);
  },
};
