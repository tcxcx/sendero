/**
 * Circle App Kit singleton + Circle-DCW adapter binding.
 *
 * Used by /api/swap, /api/send, /api/bridge and the corresponding chat
 * tools so the Pasillo agent can rebalance the corporate treasury in one
 * place.
 */

import { AppKit } from '@circle-fin/app-kit';
import type {
  BridgeResult,
  BridgeStep,
  SwapResult,
} from '@circle-fin/app-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import type {
  CircleWalletsAdapter,
  CircleWalletsAdapterOptions,
} from '@circle-fin/adapter-circle-wallets';
import { env } from './env';

let _kit: AppKit | null = null;
let _adapter: CircleWalletsAdapter | null = null;

export function getAppKit(): AppKit {
  if (!_kit) _kit = new AppKit();
  return _kit;
}

export function getTreasuryAdapter(): CircleWalletsAdapter {
  if (_adapter) return _adapter;
  const apiKey = env.circleApiKey();
  const entitySecret = env.circleEntitySecret();
  if (!apiKey || !entitySecret) {
    throw new Error(
      'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set to use App Kit.',
    );
  }
  const opts: CircleWalletsAdapterOptions = { apiKey, entitySecret };
  _adapter = createCircleWalletsAdapter(opts);
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

export function getTreasuryAddress(): string {
  const a = env.circleTreasuryAddress();
  if (!a) throw new Error('CIRCLE_TREASURY_ADDRESS not set in .env.local.');
  return a;
}

/**
 * BridgeResult and SwapResult have different shapes. Unified summary the
 * UI and chat tools can render without caring.
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
