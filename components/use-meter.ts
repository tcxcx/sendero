'use client';

/**
 * Shared hooks for consuming the edge worker's nanopayment meter.
 * Uses NEXT_PUBLIC_SENDERO_EDGE_URL (defaults to http://localhost:3020).
 */

import { useEffect, useState } from 'react';

export interface MeterSummary {
  totalUsdc: string;
  totalEvents: number;
  paidCalls: number;
  rejectedCalls: number;
  freeCalls: number;
  byTool: Record<string, { count: number; usdc: string }>;
  ethereum: {
    perCallUsd: number;
    totalUsd: number;
    marginFactor: number;
  };
}

export interface MeterEvent {
  at: number;
  toolName: string;
  priceUsdc: string;
  payer?: string;
  settlementRef?: string;
  status: 'paid' | 'free' | 'rejected';
  note?: string;
}

function edgeUrl(): string {
  if (typeof window !== 'undefined') {
    const fromEnv = (window as any).__SENDERO_EDGE_URL__;
    if (fromEnv) return String(fromEnv);
  }
  return (
    process.env.NEXT_PUBLIC_SENDERO_EDGE_URL || 'http://localhost:3020'
  );
}

export function useMeterSummary(pollMs = 1500): {
  summary: MeterSummary | null;
  error: string | null;
} {
  const [summary, setSummary] = useState<MeterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${edgeUrl()}/tools/summary`, {
          cache: 'no-store',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as MeterSummary;
        if (alive) {
          setSummary(j);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const iv = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [pollMs]);
  return { summary, error };
}

export function useMeterStream(max = 40): {
  events: MeterEvent[];
  connected: boolean;
} {
  const [events, setEvents] = useState<MeterEvent[]>([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let src: EventSource | null = null;
    try {
      src = new EventSource(`${edgeUrl()}/tools/stream`);
      src.addEventListener('meter', (ev) => {
        try {
          const e = JSON.parse((ev as MessageEvent).data) as MeterEvent;
          setEvents((prev) => [...prev, e].slice(-max));
        } catch {
          /* ignore malformed event */
        }
      });
      src.addEventListener('open', () => setConnected(true));
      src.addEventListener('error', () => setConnected(false));
    } catch {
      setConnected(false);
    }
    return () => {
      src?.close();
      setConnected(false);
    };
  }, [max]);
  return { events, connected };
}
