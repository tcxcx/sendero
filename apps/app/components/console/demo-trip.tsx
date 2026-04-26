'use client';

/**
 * Demo Trip — autonomous customer↔agent simulation that drives the REAL
 * /api/agent/chat pipeline.
 *
 * Trigger: operator types `/demo trip` (or taps the suggestion pill) in
 * the SENDERO AI composer. MetaInboxLive intercepts the slash command,
 * sets `demoActive`, and calls `runDemoTripScript({ sendMessage, ... })`.
 *
 * What happens:
 *
 *   1. Each customer prompt in PROMPTS is fed to useChat via sendMessage().
 *      The agent loop fires real tools — search_flights (Duffel sandbox),
 *      book_flight (Duffel hold + pay-from-balance), settle_booking (Arc
 *      escrow on-chain dance), mint_stamp (Circle SCP NFT mint),
 *      recommend_restaurants (Google Places).
 *   2. After each turn, we wait until useChat's status returns to 'ready'
 *      before sending the next prompt. This serializes the conversation so
 *      the agent has time to complete its tool chain before the customer
 *      asks the next question.
 *   3. The standard AI Elements stream renders everything — text, tool
 *      blocks with input/output, reasoning. Same surface as /dashboard/
 *      agent-chat. No special UI for demo mode beyond a small banner.
 *
 * Route + amount: BUE → MDZ on Friday. Real Duffel sandbox flights are
 * typically $50-150 USD on this domestic Argentina leg, so a single demo
 * burns minimal demo USDC even though it moves through the full escrow
 * dance.
 */

import { type JSX, useEffect } from 'react';

// ── types ───────────────────────────────────────────────────────────

export type DemoRole = 'customer' | 'agent' | 'tool' | 'stamp' | 'system';

/**
 * Legacy message shape — retained so existing imports (DemoConversation
 * render path) compile. The new real-agent runner does NOT push these;
 * it routes through useChat instead.
 */
export interface DemoMessage {
  id: string;
  role: DemoRole;
  text: string;
  channel: 'whatsapp' | 'internal';
  t: string;
  toolName?: string;
  stampSrc?: string;
  stampLabel?: string;
}

const ORIGIN = process.env.NEXT_PUBLIC_DEMO_TRIP_ORIGIN || 'EZE';
const DESTINATION = process.env.NEXT_PUBLIC_DEMO_TRIP_DESTINATION || 'MDZ';

/**
 * Customer prompts fired in order. Each one waits for the agent's reply
 * (status === 'ready') before firing the next. The agent autonomously
 * runs tools between prompts; we just queue the human-side messages.
 *
 * The demo is tenant-agnostic: every step routes through the signed-in
 * user's Clerk session, so any operator in any org can run it. The agent
 * resolves tenant + user wallet from the session, not from env vars.
 */
export const DEMO_TRIP_PROMPTS: ReadonlyArray<string> = [
  `Hi Sendero — I need a cheap flight from ${ORIGIN} to ${DESTINATION} this Friday. Quick weekend trip.`,
  `Yes, book the cheapest one and pay from my Duffel balance.`,
  `Now mint a real boarding-pass NFT on Arc-Testnet for that booking. Use the demo_mint_boarding_pass tool — pass the PNR you just got from book_flight, the route as "${ORIGIN} → ${DESTINATION}", and a short caption. Return the explorer URL when done so I can verify on Arcscan.`,
  `Where can I have dinner near Plaza Independencia in Mendoza? Argentine parrilla preferred.`,
];

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface RunOptions {
  /** Forward a turn to useChat. */
  sendMessage: (msg: { text: string }) => void;
  /** Snapshot of useChat's current status. Polled to detect turn boundaries. */
  getStatus: () => 'submitted' | 'streaming' | 'ready' | 'error' | string;
  /** Caller-provided abort. Returns from the loop on next tick. */
  signal?: AbortSignal;
  /** Optional progress hook so MetaInboxLive can render a "1 of 4" banner. */
  onProgress?: (current: number, total: number) => void;
}

const aborted = (signal?: AbortSignal) => Boolean(signal?.aborted);

/**
 * Drive the real agent through the demo-trip pipeline.
 *
 * For each customer prompt:
 *   1. Fire `sendMessage({ text })`.
 *   2. Poll status until it transitions away from 'ready' (turn started),
 *      then back to 'ready' (turn finished). This handles the case where
 *      sendMessage is async and useChat hasn't flipped status yet.
 *   3. Brief breather between turns so the operator can read the result.
 */
export async function runDemoTripScript(opts: RunOptions): Promise<void> {
  const { sendMessage, getStatus, signal, onProgress } = opts;
  const total = DEMO_TRIP_PROMPTS.length;

  for (let i = 0; i < DEMO_TRIP_PROMPTS.length; i++) {
    if (aborted(signal)) return;
    onProgress?.(i + 1, total);

    sendMessage({ text: DEMO_TRIP_PROMPTS[i] });

    // Wait for status to flip OUT of 'ready' (turn has started). useChat
    // sets status to 'submitted' as soon as sendMessage runs; we poll on
    // a 100ms cadence which is well under perceived UI lag.
    await waitForStatus(getStatus, s => s !== 'ready', { timeoutMs: 5_000, signal });
    if (aborted(signal)) return;

    // Now wait for status to return to 'ready' OR 'error' — the agent
    // turn (including all tool calls) has completed. settle_booking and
    // mint_stamp can take 60-90s under the hood as the on-chain dance
    // unrolls; budget 5 min per turn before we declare the run stuck.
    await waitForStatus(getStatus, s => s === 'ready' || s === 'error', {
      timeoutMs: 5 * 60 * 1000,
      signal,
    });
    if (aborted(signal)) return;
    if (getStatus() === 'error') {
      console.error('[demo-trip] agent turn errored — aborting script');
      return;
    }

    await wait(800);
  }
  onProgress?.(total, total);
}

interface WaitOpts {
  timeoutMs: number;
  signal?: AbortSignal;
}
async function waitForStatus(
  getStatus: () => string,
  pred: (s: string) => boolean,
  { timeoutMs, signal }: WaitOpts
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred(getStatus())) {
    if (aborted(signal)) return;
    if (Date.now() > deadline) {
      console.warn('[demo-trip] waitForStatus timed out at', getStatus());
      return;
    }
    await wait(100);
  }
}

// ── render (legacy stub) ─────────────────────────────────────────────
// The new real-agent demo renders through AI Elements (Conversation/
// Message/Tool from `meta-inbox-live.tsx`'s normal flow). DemoConversation
// is retained as a stub so existing imports in MetaInboxLive don't break;
// we leave it unused for now and may re-skin later as a WhatsApp wrapper
// over the live useChat messages.

interface ConversationProps {
  messages: DemoMessage[];
  onReset?: () => void;
}

export function DemoConversation({ messages: _messages, onReset }: ConversationProps): JSX.Element {
  useEffect(() => {
    // Auto-scroll hook reserved for future re-skin.
  }, []);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 14px',
        background: 'rgba(214,84,56,0.06)',
        border: '1px solid rgba(214,84,56,0.32)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--vermillion, #D65438)',
      }}
    >
      <span>
        ◉ /demo trip — running through real agent (real Duffel sandbox + real Arc-Testnet on-chain
        settlement)
      </span>
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            background: 'transparent',
            border: '1px solid currentColor',
            color: 'currentColor',
            fontSize: 10,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ↩ EXIT
        </button>
      ) : null}
    </div>
  );
}
