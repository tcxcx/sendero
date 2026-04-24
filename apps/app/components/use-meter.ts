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

function edgeUrl(): string | null {
  if (typeof window !== 'undefined') {
    const fromEnv = (window as any).__SENDERO_EDGE_URL__;
    if (fromEnv) return String(fromEnv);
  }
  const fromEnv = process.env.NEXT_PUBLIC_SENDERO_EDGE_URL;
  if (fromEnv) return fromEnv;
  // Dev convenience only. In prod, surfaces return null → callers show
  // a degraded state instead of firing cross-origin requests at a host
  // the browser can't reach (and that CORS will block).
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3020';
  return null;
}

export function useMeterSummary(pollMs = 1500): {
  summary: MeterSummary | null;
  error: string | null;
  degraded: boolean;
} {
  const [summary, setSummary] = useState<MeterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = edgeUrl();
  useEffect(() => {
    if (!base) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${base}/tools/summary`, {
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
  }, [pollMs, base]);
  return { summary, error, degraded: base === null };
}

export function useMeterStream(max = 40): {
  events: MeterEvent[];
  connected: boolean;
  degraded: boolean;
} {
  const [events, setEvents] = useState<MeterEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const base = edgeUrl();
  useEffect(() => {
    if (!base) return;
    let src: EventSource | null = null;
    try {
      src = new EventSource(`${base}/tools/stream`);
      src.addEventListener('meter', ev => {
        try {
          const e = JSON.parse((ev as MessageEvent).data) as MeterEvent;
          setEvents(prev => [...prev, e].slice(-max));
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
  }, [max, base]);
  return { events, connected, degraded: base === null };
}
