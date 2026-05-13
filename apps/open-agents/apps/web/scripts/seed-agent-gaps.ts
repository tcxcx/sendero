#!/usr/bin/env bun
/**
 * Seed five synthetic gap rows for /agent-gaps demo. Safe to re-run —
 * dedup_hash is unique so duplicates are skipped.
 */

import crypto from "node:crypto";
import postgres from "postgres";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL required");
  process.exit(1);
}

interface Seed {
  kind: string;
  severity: string;
  toolName?: string;
  errorMessage: string;
  hypothesis: string;
  blockingPr?: boolean;
  prUrl?: string;
  boardColumn: string;
  occurrenceCount?: number;
  fixSummary?: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(" ");
}

function hash(
  kind: string,
  tool: string | undefined,
  hypothesisNorm: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${kind}|${tool ?? ""}|${hypothesisNorm}`)
    .digest("hex");
}

const seeds: Seed[] = [
  {
    kind: "tool_input_mismatch",
    severity: "high",
    toolName: "scan_passport_inline",
    errorMessage:
      "Tool documentImageUrl not found in schema — agent attempted to pass field that no longer exists.",
    hypothesis:
      "Field renamed from documentImageUrl to documentUrl in agent-persona.ts; agent prompt has not been updated",
    blockingPr: true,
    prUrl: "https://github.com/BuFi007/desk-v1/pull/391",
    boardColumn: "open",
    occurrenceCount: 3,
  },
  {
    kind: "env_missing",
    severity: "high",
    errorMessage:
      "process.env.SLACK_MINION_WEBHOOK_URL is undefined inside the OA sandbox",
    hypothesis:
      "Sandbox runner is not inheriting team-scoped env vars; need to pass via callback secret block",
    boardColumn: "open",
  },
  {
    kind: "test_failure",
    severity: "medium",
    errorMessage:
      "vitest run failed: 2 tests in packages/transfer-core/__tests__/cctp.spec.ts",
    hypothesis:
      "CCTP message bytes encoding changed after viem 2.20; test fixtures still on 2.18 format",
    boardColumn: "open",
  },
  {
    kind: "sandbox_timeout",
    severity: "medium",
    errorMessage:
      "Session archived after 300s — bun install never finished in the sandbox",
    hypothesis:
      "Workspace install hits 8min on cold cache; sandbox snapshot needs a pre-warmed node_modules layer",
    boardColumn: "triaged",
    occurrenceCount: 2,
  },
  {
    kind: "schema_drift",
    severity: "low",
    errorMessage: 'column "is_default" does not exist on external_accounts',
    hypothesis:
      "Column added in 20260415-alfred-recipients migration but db.ts not regenerated; agent kept reading stale type",
    boardColumn: "resolved",
    occurrenceCount: 4,
    fixSummary: "Regenerated db.ts via supabase gen types and pushed PR #382",
  },
];

const client = postgres(url, { max: 1 });
try {
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    const hypNorm = normalize(seed.hypothesis);
    const dedup = hash(seed.kind, seed.toolName, hypNorm);
    const id = crypto.randomUUID();

    const result = await client`
      INSERT INTO knowledge_gaps (
        id, dedup_hash, kind, severity, status, board_column, board_position,
        tool_name, error_message, hypothesis, hypothesis_norm,
        occurrence_count, blocking_pr, pr_url, fix_summary, surface
      ) VALUES (
        ${id}, ${dedup}, ${seed.kind}, ${seed.severity},
        ${seed.boardColumn === "resolved" ? "resolved" : "open"},
        ${seed.boardColumn}, ${i},
        ${seed.toolName ?? null}, ${seed.errorMessage},
        ${seed.hypothesis}, ${hypNorm},
        ${seed.occurrenceCount ?? 1}, ${seed.blockingPr ?? false},
        ${seed.prUrl ?? null}, ${seed.fixSummary ?? null}, 'open-agents'
      )
      ON CONFLICT (dedup_hash) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) inserted++;
    else skipped++;
  }
  console.log(`Seeded: inserted=${inserted} skipped=${skipped}`);
} finally {
  await client.end();
}
