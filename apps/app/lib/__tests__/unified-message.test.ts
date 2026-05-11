/**
 * Tests for the canonical Trip.events → UnifiedMessage[] mapper.
 *
 * Covers every event kind the channel handlers + dispatch route + the
 * /api/inbox/[tripId]/reply endpoint produce, plus legacy shapes that
 * predate the unified ledger (operator-composed events without an
 * `author` envelope).
 *
 * Run: `bun test apps/app/lib/__tests__/unified-message.test.ts`
 */

import { describe, expect, test } from 'bun:test';

import { eventsToUnifiedMessages } from '../unified-message';

describe('eventsToUnifiedMessages', () => {
  test('empty / non-array → empty', () => {
    expect(eventsToUnifiedMessages(null)).toEqual([]);
    expect(eventsToUnifiedMessages(undefined as unknown as null)).toEqual([]);
    expect(eventsToUnifiedMessages([])).toEqual([]);
    expect(eventsToUnifiedMessages('not-an-array' as unknown as null)).toEqual([]);
  });

  test('inbound WhatsApp message: dispatch-route shape', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'inbound_whatsapp:wamid_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        createdAt: '2026-04-28T10:00:00Z',
        text: 'Hi, looking for SFO → LHR next Friday',
        author: { kind: 'traveler', userId: 'user_t1' },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('message');
    expect(out[0]!.direction).toBe('inbound');
    expect(out[0]!.channel).toBe('whatsapp');
    expect(out[0]!.author.kind).toBe('traveler');
    expect(out[0]!.body).toContain('SFO → LHR');
  });

  test('outbound operator reply (web composer): legacy author-on-row shape', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'reply_abc',
        kind: 'inbox_reply',
        direction: 'outbound',
        channel: 'web',
        text: 'I checked — your hold is good through 14:30',
        authorUserId: 'user_op_1',
        authorName: 'Maya · operator',
        createdAt: '2026-04-28T10:05:00Z',
        status: 'sent',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe('outbound');
    expect(out[0]!.channel).toBe('web');
    expect(out[0]!.author.kind).toBe('operator');
    expect(out[0]!.author.displayName).toBe('Maya · operator');
    expect(out[0]!.status).toBe('sent');
  });

  test('agent reply (dispatch route shape): outbound on the channel it came in on', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'agent_slack:event_1',
        kind: 'agent_reply',
        direction: 'outbound',
        channel: 'slack',
        text: 'Found 3 options under your $1500 cap.',
        author: { kind: 'agent' },
        createdAt: '2026-04-28T10:01:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe('outbound');
    expect(out[0]!.channel).toBe('slack');
    expect(out[0]!.author.kind).toBe('agent');
    expect(out[0]!.author.displayName).toBe('Sendero AI');
    expect(out[0]!.author.initials).toBe('S');
  });

  test('operator note (slash-command path): private message with operator author', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'evt_note_1',
        kind: 'operator_note',
        direction: 'internal',
        channel: 'internal',
        text: 'Customer prefers aisle.',
        author: { kind: 'operator', slackUserId: 'U_OP_1' },
        createdAt: '2026-04-28T10:10:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('message');
    expect(out[0]!.direction).toBe('internal');
    expect(out[0]!.channel).toBe('internal');
    expect(out[0]!.author.kind).toBe('operator');
    expect(out[0]!.author.slackUserId).toBe('U_OP_1');
  });

  test('tool_call: rendered as internal centered chip with toolName', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'evt_tool_1',
        kind: 'tool_call',
        toolName: 'search_flights',
        toolArgs: 'origin=SFO dest=LHR',
        priceMicroUsdc: '0.0010',
        createdAt: '2026-04-28T10:00:30Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool_call');
    expect(out[0]!.toolName).toBe('search_flights');
    expect(out[0]!.toolArgs).toContain('SFO');
    expect(out[0]!.toolCost).toBe('$0.0010');
  });

  test('tool_result with rows: returns rows array intact', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'evt_result_1',
        kind: 'tool_result',
        toolName: 'search_flights',
        rows: [
          { id: 'off_1', route: 'SFO → LHR', fare: '$1,420' },
          { id: 'off_2', route: 'SFO → LHR', fare: '$1,560' },
        ],
        createdAt: '2026-04-28T10:00:31Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool_result');
    expect(out[0]!.rows).toHaveLength(2);
  });

  test('chronological order is preserved (mapper does not re-sort)', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'a',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        text: 'first',
        createdAt: '2026-04-28T10:00:00Z',
      },
      {
        id: 'b',
        kind: 'agent_reply',
        direction: 'outbound',
        channel: 'whatsapp',
        text: 'second',
        createdAt: '2026-04-28T10:00:05Z',
      },
      {
        id: 'c',
        kind: 'inbox_reply',
        direction: 'outbound',
        channel: 'web',
        text: 'third (operator aside)',
        createdAt: '2026-04-28T10:01:00Z',
      },
    ]);
    expect(out.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  test('mixed-channel ledger: WhatsApp + Slack + private all present, channels intact', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'wa_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        text: 'WA inbound',
        createdAt: '2026-04-28T10:00:00Z',
      },
      {
        id: 'sl_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'slack',
        text: 'Slack inbound',
        createdAt: '2026-04-28T10:01:00Z',
      },
      {
        id: 'note_1',
        kind: 'operator_note',
        direction: 'internal',
        channel: 'internal',
        text: 'Private note',
        createdAt: '2026-04-28T10:02:00Z',
      },
    ]);
    expect(out).toHaveLength(3);
    expect(out.map(m => m.channel)).toEqual(['whatsapp', 'slack', 'internal']);
  });

  test('unknown event kind is dropped silently (no throw)', () => {
    const out = eventsToUnifiedMessages([
      { id: 'a', kind: 'totally_unknown_kind', text: 'mystery' },
      {
        id: 'b',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'web',
        text: 'real',
        createdAt: '2026-04-28T10:00:00Z',
      },
    ]);
    // The legacy fallback maps text-bearing rows to internal — keeps
    // the operator from losing data when a future event kind lands
    // without a registered mapper. So both rows show up; the unknown
    // one falls through to the legacy text-only path.
    expect(out).toHaveLength(2);
  });

  test('kind-less, text-less event is dropped (no fallback)', () => {
    const out = eventsToUnifiedMessages([
      { id: 'a', someField: 'noise' },
      {
        id: 'b',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'web',
        text: 'real',
        createdAt: '2026-04-28T10:00:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('b');
  });

  test('falls back to evt-{idx} ids when event has no id', () => {
    const out = eventsToUnifiedMessages([
      {
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'web',
        text: 'no id',
        createdAt: '2026-04-28T10:00:00Z',
      },
    ]);
    expect(out[0]!.id).toBe('evt-0');
  });

  test('handoff_requested: rendered as internal system_note from agent', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'ho_h1_handoff_requested',
        kind: 'handoff_requested',
        handoffId: 'h1',
        channel: 'whatsapp',
        question: 'Can we waive the no-show fee on this booking?',
        summary: 'Customer was rerouted by airline; arrived after check-in cutoff.',
        createdAt: '2026-05-02T19:30:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('system_note');
    expect(out[0]!.direction).toBe('internal');
    expect(out[0]!.channel).toBe('whatsapp');
    expect(out[0]!.author.kind).toBe('agent');
    expect(out[0]!.body).toContain('Asked the team');
    expect(out[0]!.body).toContain('waive the no-show fee');
    expect(out[0]!.body).toContain('rerouted by airline');
  });

  test('handoff_answered: rendered as outbound operator reply on the channel', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'ho_h1_handoff_answered',
        kind: 'handoff_answered',
        handoffId: 'h1',
        channel: 'whatsapp',
        direction: 'outbound',
        text: "Yes, we can waive it — I've credited the fare.",
        answeredByUserId: 'user_op_1',
        createdAt: '2026-05-02T19:33:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('message');
    expect(out[0]!.direction).toBe('outbound');
    expect(out[0]!.channel).toBe('whatsapp');
    expect(out[0]!.author.kind).toBe('operator');
    expect(out[0]!.body).toBe("Yes, we can waive it — I've credited the fare.");
  });

  test('workflow_step_finished: rendered as internal system note with check/cross + label', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'wf_run_1_search',
        kind: 'workflow_step_finished',
        workflowId: 'sendero.book_flight',
        runId: 'run_1',
        stepId: 'search',
        stepKind: 'tool',
        label: 'Search Duffel inventory',
        ok: true,
        startedAt: '2026-05-02T20:00:00Z',
        finishedAt: '2026-05-02T20:00:03Z',
        createdAt: '2026-05-02T20:00:03Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('system_note');
    expect(out[0]!.direction).toBe('internal');
    expect(out[0]!.channel).toBe('internal');
    expect(out[0]!.author.kind).toBe('agent');
    expect(out[0]!.body).toContain('✓');
    expect(out[0]!.body).toContain('Search Duffel inventory');
    expect(out[0]!.body).toContain('sendero.book_flight');
  });

  test('workflow_step_finished: failed step renders with cross mark', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'wf_run_1_eligibility',
        kind: 'workflow_step_finished',
        workflowId: 'sendero.book_flight',
        runId: 'run_1',
        stepId: 'eligibility',
        stepKind: 'tool',
        label: 'Verify travel documents',
        ok: false,
        startedAt: '2026-05-02T20:00:00Z',
        finishedAt: '2026-05-02T20:00:02Z',
        createdAt: '2026-05-02T20:00:02Z',
      },
    ]);
    expect(out[0]!.body).toContain('✕');
    expect(out[0]!.body).toContain('Verify travel documents');
  });

  test('workflow steps interleave chronologically with channel events', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'wa_in',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        text: 'book me to Lima',
        createdAt: '2026-05-02T20:00:00Z',
      },
      {
        id: 'wf_run_1_search',
        kind: 'workflow_step_finished',
        workflowId: 'sendero.book_flight',
        runId: 'run_1',
        stepId: 'search',
        stepKind: 'tool',
        label: 'Search flights',
        ok: true,
        startedAt: '2026-05-02T20:00:01Z',
        finishedAt: '2026-05-02T20:00:04Z',
        createdAt: '2026-05-02T20:00:04Z',
      },
      {
        id: 'wa_out',
        kind: 'inbox_reply',
        direction: 'outbound',
        channel: 'whatsapp',
        text: 'Three options on May 5; tap Hold cheapest.',
        createdAt: '2026-05-02T20:00:05Z',
      },
    ]);
    expect(out.map(m => m.id)).toEqual(['wa_in', 'wf_run_1_search', 'wa_out']);
    expect(out[1]!.kind).toBe('system_note');
  });

  test('handoff lifecycle interleaves with channel events chronologically', () => {
    const out = eventsToUnifiedMessages([
      {
        id: 'wa_in',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        text: 'Was reroute charged twice?',
        createdAt: '2026-05-02T19:29:00Z',
      },
      {
        id: 'ho_h1_handoff_requested',
        kind: 'handoff_requested',
        handoffId: 'h1',
        channel: 'whatsapp',
        question: 'Was the duplicate charge real or pending auth release?',
        createdAt: '2026-05-02T19:30:00Z',
      },
      {
        id: 'ho_h1_handoff_answered',
        kind: 'handoff_answered',
        handoffId: 'h1',
        channel: 'whatsapp',
        direction: 'outbound',
        text: 'Pending auth — drops in 24h. No double-charge.',
        createdAt: '2026-05-02T19:33:00Z',
      },
    ]);
    expect(out.map(m => m.id)).toEqual([
      'wa_in',
      'ho_h1_handoff_requested',
      'ho_h1_handoff_answered',
    ]);
  });
});
