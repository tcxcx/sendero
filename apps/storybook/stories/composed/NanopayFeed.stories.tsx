import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * NanopayFeed — the per-tool meter readout that shows the running
 * USDC spend and the most-recent tool calls. The production version
 * polls `/tools/summary` + streams `/tools/stream` from the edge
 * worker; here we drive it from fixtures so it renders in isolation.
 *
 * Promoting this to `packages/ui` is a near-term goal — this story
 * is the scaffold for that extraction.
 */

type MeterEvent = {
  at: number;
  toolName: string;
  priceUsdc: string;
  status: 'paid' | 'free' | 'rejected';
};

type Summary = {
  totalUsdc: string;
  totalEvents: number;
  paidCalls: number;
  byTool: Record<string, { count: number; usdc: string }>;
  ethereum: { perCallUsd: number; totalUsd: number; marginFactor: number };
};

function NanopayFeed({
  summary,
  events,
}: {
  summary: Summary;
  events: MeterEvent[];
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        padding: 16,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        maxWidth: 760,
      }}
    >
      <div>
        <div
          className="label"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          Nanopay meter
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, color: 'var(--text)' }}>
          ${summary.totalUsdc}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {summary.paidCalls} paid calls · {summary.totalEvents} events
        </div>
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px dashed var(--border)',
            fontSize: 11,
            color: 'var(--text-faint)',
          }}
        >
          On Ethereum mainnet: ${summary.ethereum.totalUsd.toFixed(2)} — we
          charge {summary.ethereum.marginFactor.toFixed(0)}× less.
        </div>
      </div>

      <div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          Recent
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          {events.slice(-8).reverse().map((e, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color:
                  e.status === 'rejected'
                    ? 'var(--accent-rose)'
                    : e.status === 'free'
                      ? 'var(--text-dim)'
                      : 'var(--text)',
              }}
            >
              <span>{e.toolName}</span>
              <span style={{ color: 'var(--ink)' }}>${e.priceUsdc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const emptySummary: Summary = {
  totalUsdc: '0.0000',
  totalEvents: 0,
  paidCalls: 0,
  byTool: {},
  ethereum: { perCallUsd: 2.14, totalUsd: 0, marginFactor: 1 },
};

const activeSummary: Summary = {
  totalUsdc: '0.0473',
  totalEvents: 23,
  paidCalls: 21,
  byTool: {
    search_flights: { count: 8, usdc: '0.016' },
    check_treasury: { count: 6, usdc: '0.003' },
    settle_split: { count: 2, usdc: '0.02' },
    quote_fx: { count: 5, usdc: '0.004' },
  },
  ethereum: { perCallUsd: 2.14, totalUsd: 49.22, marginFactor: 1041 },
};

const activeEvents: MeterEvent[] = [
  { at: Date.now() - 8000, toolName: 'search_flights', priceUsdc: '0.002', status: 'paid' },
  { at: Date.now() - 7000, toolName: 'quote_fx', priceUsdc: '0.0008', status: 'paid' },
  { at: Date.now() - 6000, toolName: 'check_treasury', priceUsdc: '0.0005', status: 'paid' },
  { at: Date.now() - 5000, toolName: 'settle_split', priceUsdc: '0.01', status: 'paid' },
  { at: Date.now() - 4000, toolName: 'book_flight', priceUsdc: '0.008', status: 'paid' },
  { at: Date.now() - 3000, toolName: 'gateway_balance', priceUsdc: '0.001', status: 'paid' },
  { at: Date.now() - 2000, toolName: 'send_tokens', priceUsdc: '0.003', status: 'rejected' },
  { at: Date.now() - 1000, toolName: 'rate_agent', priceUsdc: '0.0005', status: 'paid' },
];

const meta: Meta = {
  title: 'Composed/NanopayFeed',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

export const Empty: Story = {
  render: () => <NanopayFeed summary={emptySummary} events={[]} />,
};

export const Active: Story = {
  render: () => <NanopayFeed summary={activeSummary} events={activeEvents} />,
};
