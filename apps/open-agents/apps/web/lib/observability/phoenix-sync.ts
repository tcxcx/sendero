/**
 * Phoenix resolved-gaps dataset sync.
 *
 * When an operator resolves a kanban card via /api/agent-gaps/[gapId]/
 * resolve, the (hypothesis_norm, fix_summary, must_mention) triple gets
 * pushed to a Phoenix dataset named `sendero-minions-resolved-gaps`.
 *
 * A nightly Phoenix evaluator runs against new agent runtime traces:
 * any trace whose hypothesis_norm matches a resolved entry but doesn't
 * mention the `must_mention` tokens is flagged as a **self-heal
 * regression** — closing the demand-driven loop.
 *
 * Best-effort, fail-soft. Errors logged, never thrown.
 */

import { createClient } from '@arizeai/phoenix-client';
import { appendDatasetExamples, createDataset } from '@arizeai/phoenix-client/datasets';

const DATASET_NAME = 'sendero-minions-resolved-gaps';
const DATASET_DESC =
  "Resolved knowledge gaps from the Sendero Minions kanban board. Nightly evaluator scores new traces matching a resolved entry's hypothesis_norm but missing the must_mention tokens as a self-heal regression.";

export interface PhoenixResolvedGapExample {
  gapId: string;
  hypothesis: string;
  hypothesisNorm: string;
  kind: string;
  toolName: string | null;
  fixSummary: string;
  mustMention: string[];
  resolutionPrUrl: string | null;
  resolvedAt: Date;
}

function isPhoenixConfigured(): boolean {
  return Boolean(
    process.env.PHOENIX_API_KEY &&
      (process.env.PHOENIX_COLLECTOR_ENDPOINT || process.env.PHOENIX_BASE_URL)
  );
}

function buildPhoenixClient() {
  const baseUrl = (
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_BASE_URL ||
    'https://app.phoenix.arize.com'
  ).replace(/\/$/, '');
  return createClient({
    options: {
      baseUrl,
      headers: {
        authorization: `Bearer ${process.env.PHOENIX_API_KEY}`,
      },
    },
  });
}

/**
 * Push a resolved gap to the Phoenix dataset. Idempotent on (gapId)
 * via the example's stable `id` field. Tries append first; on dataset-
 * not-found, creates with the single example.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` otherwise.
 * Never throws.
 */
export async function pushResolvedToPhoenix(
  ex: PhoenixResolvedGapExample
): Promise<{ ok: boolean; reason?: string }> {
  if (!isPhoenixConfigured()) {
    return { ok: false, reason: 'phoenix_not_configured' };
  }

  const client = buildPhoenixClient();

  const example = {
    id: `gap-${ex.gapId}`,
    input: {
      hypothesis: ex.hypothesis,
      hypothesisNorm: ex.hypothesisNorm,
      kind: ex.kind,
      toolName: ex.toolName ?? null,
    },
    output: {
      fixSummary: ex.fixSummary,
      mustMention: ex.mustMention,
      resolutionPrUrl: ex.resolutionPrUrl ?? null,
    },
    metadata: {
      resolvedAt: ex.resolvedAt.toISOString(),
      source: 'sendero-minions-kanban',
    },
  };

  try {
    await appendDatasetExamples({
      client,
      dataset: { datasetName: DATASET_NAME },
      examples: [example],
    });
    return { ok: true };
  } catch (appendErr) {
    // Likely the dataset doesn't exist yet — try to create it with
    // this example as the seed row.
    try {
      await createDataset({
        client,
        name: DATASET_NAME,
        description: DATASET_DESC,
        examples: [example],
      });
      return { ok: true };
    } catch (createErr) {
      const msg = createErr instanceof Error ? createErr.message : String(createErr);
      console.warn(
        '[phoenix-sync] dataset push failed:',
        msg,
        '(append err:',
        appendErr instanceof Error ? appendErr.message : appendErr,
        ')'
      );
      return { ok: false, reason: msg };
    }
  }
}
