/**
 * Circle App Kit singleton + viem-backed treasury adapter.
 *
 * Originally wired to `createCircleWalletsAdapter` (DCW). That adapter
 * installs a custom JSON-RPC transport that refuses `eth_call` params
 * Swap Kit's viem simulation needs (gas/nonce/value/gasPrice/maxFee*),
 * so `kit.swap()` blew up with "Unsupported transaction params" on Arc.
 * The viem adapter talks directly to Arc RPC and sidesteps the filter.
 *
 * Used by /api/swap, /api/send, /api/bridge and the corresponding chat
 * tools so the Pasillo agent can rebalance the corporate treasury in
 * one place.
 */

import { AppKit } from '@circle-fin/app-kit';
import type {
  BridgeResult,
  BridgeStep,
  SwapResult,
} from '@circle-fin/app-kit';
import {
  createViemAdapterFromPrivateKey,
  type ViemAdapter,
} from '@circle-fin/adapter-viem-v2';
import { ArcTestnet } from '@circle-fin/app-kit/chains';
import {
  createPublicClient,
  http,
  type Chain as ViemChain,
  type PublicClient,
} from 'viem';
import { env } from './env';

let _kit: AppKit | null = null;
let _adapter: ViemAdapter | null = null;

export function getAppKit(): AppKit {
  if (!_kit) _kit = new AppKit();
  return _kit;
}

/**
 * Custom RPC for Arc (we pin our own RPC from env). Every other chain
 * falls through to viem's default public HTTP for that chain. Operators
 * can override any chain via CHAIN_RPC_<NAME_UPPER>.
 */
function rpcForChain(chain: ViemChain): string | undefined {
  if (chain.name === ArcTestnet.name) return env.arcRpcUrl();
  return process.env[`CHAIN_RPC_${chain.name.toUpperCase().replace(/ /g, '_')}`];
}

export function getTreasuryAdapter(): ViemAdapter {
  if (_adapter) return _adapter;
  const privateKey = env.treasuryPrivateKey();
  if (!privateKey) {
    throw new Error(
      'TREASURY_PRIVATE_KEY required for App Kit viem adapter. ' +
        'Generate an EOA (viem `generatePrivateKey`) and fund it from https://faucet.circle.com.',
    );
  }
  _adapter = createViemAdapterFromPrivateKey({
    privateKey,
    getPublicClient: ({ chain }): PublicClient => {
      const rpcUrl = rpcForChain(chain);
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { retryCount: 3, timeout: 15_000 }),
      });
      return client as PublicClient;
    },
  });
  return _adapter;
}

export function getKitKey(): string {
  const k = process.env.CIRCLE_KIT_KEY;
  if (!k) {
    throw new Error(
      'CIRCLE_KIT_KEY required (format KIT_KEY:<id>:<secret>). Generate one at https://developers.circle.com/w3s/keys#kit-keys and add to .env.local.',
    );
  }
  return k;
}

/**
 * Treasury address used by App Kit operations — the EOA derived from
 * TREASURY_PRIVATE_KEY. Distinct from CIRCLE_TREASURY_ADDRESS (DCW),
 * which continues to back /api/fund-msca for user MSCA drips.
 */
export function getTreasuryAddress(): string {
  const a = env.treasuryViemAddress() || env.circleTreasuryAddress();
  if (!a)
    throw new Error(
      'TREASURY_VIEM_ADDRESS (or CIRCLE_TREASURY_ADDRESS) not set in .env.local.',
    );
  return a;
}

/**
 * BridgeResult and SwapResult have different shapes. Unified summary
 * the UI and chat tools can render without caring.
 */
export interface OpSummary {
  state: string;
  txHash: string | null;
  explorerUrl: string | null;
  steps: Array<{
    name: string;
    state: string;
    txHash?: string;
    explorerUrl?: string;
  }>;
  /** Set on swap: the amount of tokenOut actually received. */
  amountOut?: string;
}

export function summarizeBridge(result: BridgeResult): OpSummary {
  const steps: BridgeStep[] = Array.isArray(result.steps) ? result.steps : [];
  const last = steps[steps.length - 1];
  return {
    state: String(result.state ?? ''),
    txHash: last?.txHash ?? null,
    explorerUrl: last?.explorerUrl ?? null,
    steps: steps.map((s) => ({
      name: s.name,
      state: String(s.state),
      txHash: s.txHash,
      explorerUrl: s.explorerUrl,
    })),
  };
}

export function summarizeSwap(result: SwapResult): OpSummary {
  return {
    state: 'success',
    txHash: result.txHash ?? null,
    explorerUrl: result.explorerUrl ?? null,
    steps: [
      {
        name: 'swap',
        state: 'success',
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
      },
    ],
    amountOut: result.amountOut,
  };
}

export function summarizeSend(step: BridgeStep): OpSummary {
  return {
    state: String(step.state ?? ''),
    txHash: step.txHash ?? null,
    explorerUrl: step.explorerUrl ?? null,
    steps: [
      {
        name: step.name,
        state: String(step.state),
        txHash: step.txHash,
        explorerUrl: step.explorerUrl,
      },
    ],
  };
}
