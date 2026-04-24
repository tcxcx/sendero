'use client';

/**
 * useArcChainStream — push-based chain head + gas price for the FooterRail.
 *
 * Replaces 20s RPC polling with a single viem WebSocket subscription:
 *   - watchBlocks fires once per new block (sub-second on Arc)
 *   - we forward `number` and `baseFeePerGas` (or fallback gasPrice) into
 *     the zustand store under treasury.arc.{blockNumber, gasPrice}
 *
 * Falls back silently if the WS endpoint is unreachable — the polled
 * REST snapshot in refreshTreasury still seeds the initial values.
 */

import { useEffect } from 'react';

import { createPublicClient, webSocket } from 'viem';

import { useSendero } from './store';

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002);

function resolveWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_ARC_WS_URL;
  if (explicit) return explicit;
  const rpc = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
  return rpc.replace(/^https?:\/\//, m => (m === 'https://' ? 'wss://' : 'ws://'));
}

export function useArcChainStream() {
  const setArcStatus = useSendero(s => s.setArcStatus);

  useEffect(() => {
    const url = resolveWsUrl();
    let unwatch: (() => void) | null = null;
    let client: ReturnType<typeof createPublicClient> | null = null;

    try {
      client = createPublicClient({
        transport: webSocket(url, { retryCount: 5, retryDelay: 1500 }),
        chain: {
          id: ARC_CHAIN_ID,
          name: 'Arc',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: { default: { http: [], webSocket: [url] } },
        },
      });

      unwatch = client.watchBlocks({
        emitOnBegin: true,
        onBlock: block => {
          // Arc reports baseFeePerGas like any EIP-1559 chain. Fall back to
          // legacy gasPrice if the field is absent (some Geth forks).
          const gas = block.baseFeePerGas ?? null;
          setArcStatus({
            blockNumber: block.number?.toString() ?? '—',
            ...(gas !== null ? { gasPrice: gas.toString() } : {}),
          });
        },
        onError: () => {
          // Connection blip — viem's webSocket transport auto-reconnects;
          // the polled refreshTreasury continues to keep state fresh.
        },
      });
    } catch {
      // WS endpoint not available (e.g., ws:// blocked). Polling carries on.
    }

    return () => {
      try {
        unwatch?.();
      } catch {}
    };
  }, [setArcStatus]);
}
