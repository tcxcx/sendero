/**
 * Tests for the interactions parser + ViewRouter.
 *
 * Run: `bun test packages/slack/src/interactions.test.ts`
 */

import { describe, expect, test } from 'bun:test';

import {
  parseInteractionBody,
  serializeSubmissionResult,
  ViewRouter,
  type ViewSubmissionPayload,
  type ViewClosedPayload,
} from './interactions';

function urlEncode(payload: unknown): string {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

describe('parseInteractionBody', () => {
  test('parses block_actions', () => {
    const result = parseInteractionBody(
      urlEncode({
        type: 'block_actions',
        user: { id: 'U1' },
        team: { id: 'T1' },
        actions: [{ type: 'button', action_id: 'sendero_approval.approve' }],
        response_url: 'https://hooks.slack.com/x',
        trigger_id: 'tr_1',
      })
    );
    expect(result?.type).toBe('block_actions');
  });

  test('parses view_submission', () => {
    const result = parseInteractionBody(
      urlEncode({
        type: 'view_submission',
        user: { id: 'U1' },
        team: { id: 'T1' },
        trigger_id: 'tr_1',
        view: {
          id: 'V1',
          callback_id: 'sendero.trip_note',
          private_metadata: '{"tripId":"trip_abc"}',
          state: { values: {} },
        },
      })
    );
    expect(result?.type).toBe('view_submission');
  });

  test('parses view_closed', () => {
    const result = parseInteractionBody(
      urlEncode({
        type: 'view_closed',
        user: { id: 'U1' },
        view: { id: 'V1', callback_id: 'sendero.trip_note' },
        is_cleared: true,
      })
    );
    expect(result?.type).toBe('view_closed');
  });

  test('unknown payload type returns null (caller silently 200s)', () => {
    const result = parseInteractionBody(
      urlEncode({ type: 'shortcut', user: { id: 'U1' } })
    );
    expect(result).toBeNull();
  });

  test('missing payload field returns null', () => {
    expect(parseInteractionBody('foo=bar')).toBeNull();
  });

  test('invalid JSON returns null', () => {
    expect(parseInteractionBody('payload=not-json')).toBeNull();
  });
});

describe('ViewRouter', () => {
  function payload(callbackId: string): ViewSubmissionPayload {
    return {
      type: 'view_submission',
      user: { id: 'U1' },
      trigger_id: 'tr_1',
      view: {
        id: 'V1',
        callback_id: callbackId,
        state: { values: {} },
      },
    };
  }
  function closed(callbackId: string): ViewClosedPayload {
    return {
      type: 'view_closed',
      user: { id: 'U1' },
      view: { id: 'V1', callback_id: callbackId },
      is_cleared: false,
    };
  }

  test('dispatchSubmission routes to the matching handler', async () => {
    const router = new ViewRouter().registerSubmission('sendero.x', async () => ({
      kind: 'ack',
    }));
    const result = await router.dispatchSubmission(payload('sendero.x'));
    expect(result).toEqual({ kind: 'ack' });
  });

  test('dispatchSubmission falls back to ack when no handler matches', async () => {
    const router = new ViewRouter();
    const result = await router.dispatchSubmission(payload('sendero.unknown'));
    expect(result).toEqual({ kind: 'ack' });
  });

  test('dispatchSubmission propagates errors response_action', async () => {
    const router = new ViewRouter().registerSubmission('sendero.x', async () => ({
      kind: 'errors',
      errors: { block_a: 'Bad value' },
    }));
    const result = await router.dispatchSubmission(payload('sendero.x'));
    expect(result).toEqual({
      kind: 'errors',
      errors: { block_a: 'Bad value' },
    });
  });

  test('dispatchClosed signals handled vs unhandled', async () => {
    let invoked = false;
    const router = new ViewRouter().registerClosed('sendero.x', async () => {
      invoked = true;
    });
    expect(await router.dispatchClosed(closed('sendero.x'))).toEqual({ handled: true });
    expect(invoked).toBe(true);
    expect(await router.dispatchClosed(closed('sendero.unknown'))).toEqual({ handled: false });
  });
});

describe('serializeSubmissionResult', () => {
  test('ack → empty body (Slack closes modal)', () => {
    expect(serializeSubmissionResult({ kind: 'ack' })).toEqual({});
  });
  test('errors → response_action errors envelope', () => {
    expect(
      serializeSubmissionResult({ kind: 'errors', errors: { block_a: 'msg' } })
    ).toEqual({ response_action: 'errors', errors: { block_a: 'msg' } });
  });
  test('update → response_action update with view', () => {
    const v = { type: 'modal', title: 'X' };
    expect(serializeSubmissionResult({ kind: 'update', view: v })).toEqual({
      response_action: 'update',
      view: v,
    });
  });
  test('push → response_action push with view', () => {
    const v = { type: 'modal', title: 'Y' };
    expect(serializeSubmissionResult({ kind: 'push', view: v })).toEqual({
      response_action: 'push',
      view: v,
    });
  });
  test('clear → response_action clear', () => {
    expect(serializeSubmissionResult({ kind: 'clear' })).toEqual({
      response_action: 'clear',
    });
  });
});
