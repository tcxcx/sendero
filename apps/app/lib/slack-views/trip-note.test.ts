/**
 * Tests for the trip-note Slack view: builder + submit handler.
 *
 * Mocks `@sendero/database` (Prisma) at module level so the handler
 * can run against an in-memory fake. Asserts the four meaningful
 * paths: missing metadata → errors, empty note → errors, oversized
 * note → errors, success → ack + events appended.
 *
 * Run: `bun test apps/app/lib/slack-views/trip-note.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ViewSubmissionPayload } from '@sendero/slack';

interface TripRow {
  id: string;
  tenantId: string;
  events: unknown;
}

const state = {
  trips: new Map<string, TripRow>(),
  /**
   * Records `(tripId, tenantIdMatched, appendedEvent)` so tests can
   * assert both the WHERE-clause tenant gate AND the JSONB append
   * payload. The atomic-append fix uses `$executeRaw`, so we mock
   * that directly instead of `update`.
   */
  rawAppends: [] as Array<{ tripId: string; tenantId: string; appended: unknown[] }>,
};

mock.module('@sendero/database', () => ({
  prisma: {
    trip: {
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.trips.get(args.where.id);
        if (!row) return null;
        return { id: row.id, tenantId: row.tenantId };
      },
    },
    // Match the new $executeRaw path. Bun's mock receives the tagged
    // template strings + values; we inspect the values to recover
    // (jsonb-array-string, tripId, tenantId).
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [appendedJson, tripId, tenantId] = values as [string, string, string];
      const row = state.trips.get(tripId);
      // Tenant gate must match, mirroring the WHERE clause in the SQL.
      if (!row || row.tenantId !== tenantId) return 0;
      const appended = JSON.parse(appendedJson) as unknown[];
      const existing = Array.isArray(row.events) ? (row.events as unknown[]) : [];
      row.events = [...existing, ...appended];
      state.rawAppends.push({ tripId, tenantId, appended });
      return appended.length;
    },
  },
}));

const { buildTripNoteView, handleTripNoteSubmission, TRIP_NOTE_CALLBACK_ID } = await import(
  './trip-note'
);

beforeEach(() => {
  state.trips.clear();
  state.rawAppends = [];
  state.trips.set('trip_abc', { id: 'trip_abc', tenantId: 'tnt_1', events: [] });
});

afterEach(() => {
  state.trips.clear();
  state.rawAppends = [];
});

function buildSubmissionPayload(opts: {
  tripId?: string;
  noteText: string;
  metadataString?: string;
}): ViewSubmissionPayload {
  const metadata =
    opts.metadataString ??
    JSON.stringify({ tripId: opts.tripId ?? 'trip_abc', channelId: 'C1', threadTs: '1.0' });
  return {
    type: 'view_submission',
    user: { id: 'U_OP' },
    team: { id: 'T1' },
    trigger_id: 'tr_1',
    view: {
      id: 'V_1',
      callback_id: TRIP_NOTE_CALLBACK_ID,
      private_metadata: metadata,
      state: {
        values: {
          sendero_note_input: {
            note_text: { type: 'plain_text_input', value: opts.noteText },
          },
        },
      },
    },
  };
}

describe('buildTripNoteView', () => {
  test('emits a modal with the canonical callback_id', () => {
    const view = buildTripNoteView({ tripId: 'trip_xyz' });
    expect(view.type).toBe('modal');
    expect(view.callback_id).toBe(TRIP_NOTE_CALLBACK_ID);
    expect(view.title.text).toBe('Add a trip note');
  });

  test('encodes private_metadata as JSON with the trip id and optional channel context', () => {
    const view = buildTripNoteView({
      tripId: 'trip_xyz',
      channelId: 'C42',
      threadTs: '1234567890.0',
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta).toEqual({
      tripId: 'trip_xyz',
      channelId: 'C42',
      threadTs: '1234567890.0',
    });
  });

  test('passes initialText into the textarea', () => {
    const view = buildTripNoteView({ tripId: 'trip_xyz', initialText: 'draft' });
    const inputBlock = view.blocks[1] as {
      element: { initial_value: string };
    };
    expect(inputBlock.element.initial_value).toBe('draft');
  });
});

describe('handleTripNoteSubmission', () => {
  test('happy path: appends an operator_note event and returns ack', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ noteText: 'Customer prefers aisle.' }),
      { tenantId: 'tnt_1' }
    );
    expect(result).toEqual({ kind: 'ack' });
    expect(state.rawAppends).toHaveLength(1);
    const append = state.rawAppends[0]!;
    expect(append.tripId).toBe('trip_abc');
    expect(append.tenantId).toBe('tnt_1');
    expect(append.appended).toHaveLength(1);
    expect(append.appended[0]).toMatchObject({
      type: 'operator_note',
      text: 'Customer prefers aisle.',
      author: { source: 'slack', slackUserId: 'U_OP' },
    });
    expect(typeof (append.appended[0] as { at: unknown }).at).toBe('string');
  });

  test('preserves existing events when appending', async () => {
    state.trips.set('trip_abc', {
      id: 'trip_abc',
      tenantId: 'tnt_1',
      events: [{ type: 'agent_turn', at: '2026-04-26T00:00:00Z' }],
    });
    await handleTripNoteSubmission(buildSubmissionPayload({ noteText: 'Note 1' }), {
      tenantId: 'tnt_1',
    });
    const trip = state.trips.get('trip_abc')!;
    const written = trip.events as Array<Record<string, unknown>>;
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ type: 'agent_turn' });
    expect(written[1]).toMatchObject({ type: 'operator_note', text: 'Note 1' });
  });

  test('empty note → errors', async () => {
    const result = await handleTripNoteSubmission(buildSubmissionPayload({ noteText: '   ' }), {
      tenantId: 'tnt_1',
    });
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toBe('Note cannot be empty.');
    }
    expect(state.rawAppends).toHaveLength(0);
  });

  test('over-length note → errors with the limit echoed', async () => {
    const overlong = 'x'.repeat(2001);
    const result = await handleTripNoteSubmission(buildSubmissionPayload({ noteText: overlong }), {
      tenantId: 'tnt_1',
    });
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toMatch(/2000-character/);
    }
    expect(state.rawAppends).toHaveLength(0);
  });

  test('missing private_metadata → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ noteText: 'fine', metadataString: '' }),
      { tenantId: 'tnt_1' }
    );
    expect(result.kind).toBe('errors');
    expect(state.rawAppends).toHaveLength(0);
  });

  test('malformed private_metadata → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ noteText: 'fine', metadataString: 'not-json' }),
      { tenantId: 'tnt_1' }
    );
    expect(result.kind).toBe('errors');
    expect(state.rawAppends).toHaveLength(0);
  });

  test('unknown trip id → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ tripId: 'trip_does_not_exist', noteText: 'fine' }),
      { tenantId: 'tnt_1' }
    );
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toMatch(/Trip not found/);
    }
    expect(state.rawAppends).toHaveLength(0);
  });

  test('cross-tenant trip id → "not found" (no leak, no write)', async () => {
    // Trip belongs to tnt_2 but the install resolved to tnt_1.
    state.trips.set('trip_other', { id: 'trip_other', tenantId: 'tnt_2', events: [] });
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ tripId: 'trip_other', noteText: 'sneaky note' }),
      { tenantId: 'tnt_1' }
    );
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      // Same error string as missing-trip — never leak existence.
      expect(result.errors.sendero_note_input).toMatch(/Trip not found/);
    }
    expect(state.rawAppends).toHaveLength(0);
    // Other tenant's trip stays untouched.
    expect(state.trips.get('trip_other')!.events).toEqual([]);
  });
});
