/**
 * Slack "Add note to trip" modal — the canonical first view-handler.
 *
 * Mounted at callback_id `sendero.trip_note`. Carries `tripId` (and
 * optionally `channelId` + `threadTs` for an after-submit echo) in
 * `private_metadata` as a JSON string — Slack treats the field as
 * opaque, so JSON-encoding gives us a typed read on submission.
 *
 * Submit handler appends a structured `operator_note` event onto
 * `Trip.events` (Json append-only log). No new schema needed; the
 * Trip model already documents `events` as the audit trail for agent
 * turns / approvals / now operator notes.
 *
 * Future view handlers slot in as siblings of this file:
 * `slack-views/booking-refine.ts`, `slack-views/passport-intake.ts`, …
 * The route uses a single `ViewRouter` to dispatch by callback_id.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@sendero/database';
import type { ViewSubmissionPayload, ViewSubmissionResult } from '@sendero/slack';

/** Stable callback_id — referenced by the modal opener AND the handler. */
export const TRIP_NOTE_CALLBACK_ID = 'sendero.trip_note';

const NOTE_BLOCK_ID = 'sendero_note_input';
const NOTE_ACTION_ID = 'note_text';
const MAX_NOTE_LENGTH = 2000;

interface TripNotePrivateMetadata {
  tripId: string;
  /** Slack channel + thread to echo into post-submit (optional). */
  channelId?: string;
  threadTs?: string;
}

/**
 * Build the modal `view` object for `views.open` / `views.update`.
 * Pass the `tripId` (and optional Slack thread context) to round-trip
 * through the user's submit.
 */
export function buildTripNoteView(args: {
  tripId: string;
  channelId?: string;
  threadTs?: string;
  initialText?: string;
}) {
  const metadata: TripNotePrivateMetadata = {
    tripId: args.tripId,
    ...(args.channelId ? { channelId: args.channelId } : {}),
    ...(args.threadTs ? { threadTs: args.threadTs } : {}),
  };

  return {
    type: 'modal' as const,
    callback_id: TRIP_NOTE_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text' as const, text: 'Add a trip note' },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `Add an operator note to trip \`${args.tripId}\`. Notes are visible to anyone with workspace access in Sendero.`,
        },
      },
      {
        type: 'input' as const,
        block_id: NOTE_BLOCK_ID,
        label: { type: 'plain_text' as const, text: 'Note' },
        element: {
          type: 'plain_text_input' as const,
          action_id: NOTE_ACTION_ID,
          multiline: true,
          max_length: MAX_NOTE_LENGTH,
          placeholder: {
            type: 'plain_text' as const,
            text: 'e.g. Customer prefers aisle seats; rebook on 12 Apr if A380 not available.',
          },
          initial_value: args.initialText ?? '',
        },
      },
    ],
  };
}

/**
 * Submit handler — validates the note, appends to `Trip.events`, returns
 * `ack` (close modal) on success or `errors` (keep modal open with
 * field error) on validation fail.
 */
export async function handleTripNoteSubmission(
  payload: ViewSubmissionPayload
): Promise<ViewSubmissionResult> {
  const metadata = parseMetadata(payload.view.private_metadata);
  if (!metadata) {
    return {
      kind: 'errors',
      errors: {
        [NOTE_BLOCK_ID]: 'Internal error — modal context lost. Close and reopen.',
      },
    };
  }

  const noteText = readNoteText(payload);
  const trimmed = noteText.trim();
  if (trimmed.length === 0) {
    return { kind: 'errors', errors: { [NOTE_BLOCK_ID]: 'Note cannot be empty.' } };
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      kind: 'errors',
      errors: { [NOTE_BLOCK_ID]: `Note exceeds the ${MAX_NOTE_LENGTH}-character limit.` },
    };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: metadata.tripId },
    select: { id: true, tenantId: true, events: true },
  });
  if (!trip) {
    return {
      kind: 'errors',
      errors: { [NOTE_BLOCK_ID]: 'Trip not found. It may have been removed.' },
    };
  }

  // Append to the events log. The column is `Json @default("[]")` — we
  // narrow defensively in case an older row has a different shape. Cast
  // to Prisma.InputJsonValue at the boundary because we've already
  // validated `trip.events` is an array of JSON-shaped values.
  const existingEvents = Array.isArray(trip.events) ? (trip.events as unknown[]) : [];
  const noteEvent = {
    type: 'operator_note' as const,
    text: trimmed,
    author: { source: 'slack' as const, slackUserId: payload.user.id },
    at: new Date().toISOString(),
  };
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      events: [...existingEvents, noteEvent] as Prisma.InputJsonValue,
    },
  });

  return { kind: 'ack' };
}

function parseMetadata(raw: string | undefined): TripNotePrivateMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TripNotePrivateMetadata>;
    if (typeof parsed.tripId !== 'string' || parsed.tripId.length === 0) return null;
    return {
      tripId: parsed.tripId,
      ...(typeof parsed.channelId === 'string' ? { channelId: parsed.channelId } : {}),
      ...(typeof parsed.threadTs === 'string' ? { threadTs: parsed.threadTs } : {}),
    };
  } catch {
    return null;
  }
}

function readNoteText(payload: ViewSubmissionPayload): string {
  const block = payload.view.state.values[NOTE_BLOCK_ID];
  if (!block) return '';
  const field = block[NOTE_ACTION_ID];
  return typeof field?.value === 'string' ? field.value : '';
}
