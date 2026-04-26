/**
 * Tiny per-step helpers that publish StampProgressEvent rows onto the
 * WDK readable stream attached to this run. The dashboard StampCard
 * subscribes via `/api/workflows/stamps/[runId]/stream` and replaces
 * its shimmering skeleton in real time as each step completes.
 *
 * Mirrors birthday-card-generator/app/api/generate/stream-progress.ts.
 */

import { getWritable } from 'workflow';

import type { StampProgressEvent } from '../shared/types';

export const writeStampProgress = async (event: StampProgressEvent) => {
  'use step';
  const writable = getWritable<string>();
  const writer = writable.getWriter();
  await writer.write(`${JSON.stringify(event)}\n`);
  writer.releaseLock();
};

export const closeStampProgress = async () => {
  'use step';
  await getWritable<string>().close();
};
