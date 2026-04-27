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
  updates: [] as Array<{ where: { id: string }; data: { events: unknown } }>,
};

mock.module('@sendero/database', () => ({
  prisma: {
    trip: {
      findUnique: async (args: { where: { id: string }; select?: unknown }) => {
        const row = state.trips.get(args.where.id);
        return row ?? null;
      },
      update: async (args: { where: { id: string }; data: { events: unknown } }) => {
        state.updates.push(args);
        const row = state.trips.get(args.where.id);
        if (row) row.events = args.data.events;
        return row ?? null;
      },
    },
  },
}));

const { buildTripNoteView, handleTripNoteSubmission, TRIP_NOTE_CALLBACK_ID } = await import(
  './trip-note'
);

beforeEach(() => {
  state.trips.clear();
  state.updates = [];
  state.trips.set('trip_abc', { id: 'trip_abc', tenantId: 'tnt_1', events: [] });
});

afterEach(() => {
  state.trips.clear();
  state.updates = [];
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
      buildSubmissionPayload({ noteText: 'Customer prefers aisle.' })
    );
    expect(result).toEqual({ kind: 'ack' });
    expect(state.updates).toHaveLength(1);
    const written = state.updates[0]!.data.events as Array<Record<string, unknown>>;
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      type: 'operator_note',
      text: 'Customer prefers aisle.',
      author: { source: 'slack', slackUserId: 'U_OP' },
    });
    expect(typeof (written[0] as { at: unknown }).at).toBe('string');
  });

  test('preserves existing events when appending', async () => {
    state.trips.set('trip_abc', {
      id: 'trip_abc',
      tenantId: 'tnt_1',
      events: [{ type: 'agent_turn', at: '2026-04-26T00:00:00Z' }],
    });
    await handleTripNoteSubmission(buildSubmissionPayload({ noteText: 'Note 1' }));
    const written = state.updates[0]!.data.events as Array<Record<string, unknown>>;
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ type: 'agent_turn' });
    expect(written[1]).toMatchObject({ type: 'operator_note', text: 'Note 1' });
  });

  test('empty note → errors', async () => {
    const result = await handleTripNoteSubmission(buildSubmissionPayload({ noteText: '   ' }));
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toBe('Note cannot be empty.');
    }
    expect(state.updates).toHaveLength(0);
  });

  test('over-length note → errors with the limit echoed', async () => {
    const overlong = 'x'.repeat(2001);
    const result = await handleTripNoteSubmission(buildSubmissionPayload({ noteText: overlong }));
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toMatch(/2000-character/);
    }
    expect(state.updates).toHaveLength(0);
  });

  test('missing private_metadata → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ noteText: 'fine', metadataString: '' })
    );
    expect(result.kind).toBe('errors');
    expect(state.updates).toHaveLength(0);
  });

  test('malformed private_metadata → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ noteText: 'fine', metadataString: 'not-json' })
    );
    expect(result.kind).toBe('errors');
    expect(state.updates).toHaveLength(0);
  });

  test('unknown trip id → errors', async () => {
    const result = await handleTripNoteSubmission(
      buildSubmissionPayload({ tripId: 'trip_does_not_exist', noteText: 'fine' })
    );
    expect(result.kind).toBe('errors');
    if (result.kind === 'errors') {
      expect(result.errors.sendero_note_input).toMatch(/Trip not found/);
    }
    expect(state.updates).toHaveLength(0);
  });
});
