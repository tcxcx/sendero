export interface RecordedWebhookEvent {
  id: string;
  alreadyProcessed: boolean;
}

export interface DurableWebhookStore {
  record(args: {
    provider: string;
    externalId: string;
    eventType: string;
    payload: unknown;
  }): Promise<RecordedWebhookEvent>;
  markProcessed(id: string, acceptedError?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export interface DurableWebhookLogger {
  error(...args: unknown[]): void;
}

export interface ProcessDurableWebhookOptions<TEvent, TResult> {
  provider: string;
  externalId: string;
  eventType: string;
  payload: unknown;
  event: TEvent;
  store: DurableWebhookStore;
  dispatch(event: TEvent): Promise<TResult>;
  acceptedError?(result: TResult): string | null | undefined;
  logger?: DurableWebhookLogger;
  logPrefix?: string;
}

export type DurableWebhookProcessResult<TResult> =
  | { ok: true; deduped: true; recordId: string }
  | { ok: true; deduped: false; recordId: string; result: TResult; acceptedError?: string }
  | { ok: false; deduped: false; recordId: string; error: string };

export async function processDurableWebhook<TEvent, TResult>(
  options: ProcessDurableWebhookOptions<TEvent, TResult>
): Promise<DurableWebhookProcessResult<TResult>> {
  const record = await options.store.record({
    provider: options.provider,
    externalId: options.externalId,
    eventType: options.eventType,
    payload: options.payload,
  });

  if (record.alreadyProcessed) {
    return { ok: true, deduped: true, recordId: record.id };
  }

  try {
    const result = await options.dispatch(options.event);
    const acceptedError = options.acceptedError?.(result) ?? undefined;
    await options.store.markProcessed(record.id, acceptedError);
    return { ok: true, deduped: false, recordId: record.id, result, acceptedError };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await options.store.markFailed(record.id, error);
    options.logger?.error(options.logPrefix ?? '[webhooks]', options.eventType, error);
    return { ok: false, deduped: false, recordId: record.id, error };
  }
}
