/**
 * @sendero/langfuse/flush — Force-flush for serverless contexts
 *
 * Call at the end of every agent turn, Trigger.dev task, and cron job.
 * Ensures all buffered Langfuse events are shipped before the function
 * instance spins down.
 *
 * In Next.js routes: call inside after() so it doesn't block the response.
 * In background jobs: call at task completion.
 */

import { getClient } from './client';
import { getSpanProcessor } from './otel';

export async function flushLangfuse(): Promise<void> {
  const promises: Promise<void>[] = [];

  const client = getClient();
  if (client) {
    promises.push(client.flush().catch(() => {}));
  }

  const spanProcessor = getSpanProcessor();
  if (spanProcessor) {
    promises.push(spanProcessor.forceFlush().catch(() => {}));
  }

  await Promise.all(promises);
}
