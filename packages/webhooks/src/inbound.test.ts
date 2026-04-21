import {
  type DurableWebhookStore,
  processDurableWebhook,
  type RecordedWebhookEvent,
} from './inbound';
import { describe, expect, test } from 'bun:test';

class MemoryStore implements DurableWebhookStore {
  records = new Map<string, RecordedWebhookEvent & { processedAt?: Date; error?: string }>();

  async record(args: {
    provider: string;
    externalId: string;
    eventType: string;
    payload: unknown;
  }): Promise<RecordedWebhookEvent> {
    const key = `${args.provider}:${args.externalId}`;
    const existing = this.records.get(key);
    if (existing) {
      return { id: existing.id, alreadyProcessed: Boolean(existing.processedAt) };
    }
    const record = { id: key, alreadyProcessed: false };
    this.records.set(key, record);
    return record;
  }

  async markProcessed(id: string, acceptedError?: string): Promise<void> {
    const record = this.records.get(id);
    if (record) {
      record.processedAt = new Date();
      record.error = acceptedError;
    }
  }

  async markFailed(id: string, error: string): Promise<void> {
    const record = this.records.get(id);
    if (record) {
      record.processedAt = undefined;
      record.error = error;
    }
  }
}

describe('processDurableWebhook', () => {
  test('dispatches once and dedupes processed retries', async () => {
    const store = new MemoryStore();
    let calls = 0;

    const first = await processDurableWebhook({
      provider: 'test',
      externalId: 'evt_1',
      eventType: 'thing.created',
      payload: { ok: true },
      event: { ok: true },
      store,
      dispatch: async () => {
        calls += 1;
        return { handled: true };
      },
    });
    const second = await processDurableWebhook({
      provider: 'test',
      externalId: 'evt_1',
      eventType: 'thing.created',
      payload: { ok: true },
      event: { ok: true },
      store,
      dispatch: async () => {
        calls += 1;
        return { handled: true };
      },
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, deduped: true, recordId: 'test:evt_1' });
    expect(calls).toBe(1);
  });

  test('keeps failed dispatches retryable', async () => {
    const store = new MemoryStore();
    let calls = 0;

    const first = await processDurableWebhook({
      provider: 'test',
      externalId: 'evt_2',
      eventType: 'thing.created',
      payload: {},
      event: {},
      store,
      dispatch: async () => {
        calls += 1;
        throw new Error('temporary failure');
      },
    });
    const second = await processDurableWebhook({
      provider: 'test',
      externalId: 'evt_2',
      eventType: 'thing.created',
      payload: {},
      event: {},
      store,
      dispatch: async () => {
        calls += 1;
        return { handled: true };
      },
    });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('records accepted nonfatal errors as processed', async () => {
    const store = new MemoryStore();

    const result = await processDurableWebhook({
      provider: 'test',
      externalId: 'evt_3',
      eventType: 'thing.created',
      payload: {},
      event: {},
      store,
      dispatch: async () => ({ matched: false }),
      acceptedError: value => (value.matched ? null : 'no_match'),
    });
    const record = store.records.get('test:evt_3');

    expect(result.ok).toBe(true);
    expect(record?.processedAt).toBeInstanceOf(Date);
    expect(record?.error).toBe('no_match');
  });
});
