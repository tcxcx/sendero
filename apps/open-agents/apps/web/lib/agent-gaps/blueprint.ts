/**
 * Synthesize a minion dispatch payload from a gap row. The blueprint is
 * the same shape consumed by `@open-agents/agent` / the dispatch route.
 */

import type { KnowledgeGap } from "@/lib/db/schema";

export interface GapBlueprint {
  version: number;
  source: "agent-gaps-board";
  taskId: string;
  title: string;
  summary: string;
  baseRef: string;
  scopePaths: string[];
  owners: string[];
  acceptanceCriteria: string[];
  validationCommands: string[];
  docs: string[];
  riskTier: "low" | "medium" | "high";
  rawTask: string;
  labels: string[];
  notes: string;
}

export function buildBlueprintFromGap(row: KnowledgeGap): GapBlueprint {
  const acceptance: string[] = [];
  if (row.fixSummary) acceptance.push(`Apply known fix: ${row.fixSummary}`);
  acceptance.push("Reproduce the failure described in the hypothesis.");
  acceptance.push("Add a regression test if applicable.");
  acceptance.push("Open a PR — do not push to a protected branch.");

  const notes = [
    `Originating gap: ${row.id}`,
    `Kind: ${row.kind}`,
    `Severity: ${row.severity}`,
    `Occurrences: ${row.occurrenceCount}`,
    row.mustMention.length > 0
      ? `Mandatory references: ${row.mustMention.join(", ")}`
      : null,
    row.resolutionPrUrl ? `Prior resolution PR: ${row.resolutionPrUrl}` : null,
    row.prUrl ? `Last blocking PR: ${row.prUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const riskTier: "low" | "medium" | "high" =
    row.severity === "critical" || row.severity === "high"
      ? "high"
      : row.severity === "medium"
        ? "medium"
        : "low";

  return {
    version: 1,
    source: "agent-gaps-board",
    taskId: `gap-${row.id}`,
    title: `[Gap ${row.kind}] ${row.hypothesis.slice(0, 120)}`,
    summary: row.hypothesis,
    baseRef: row.branchRef ?? "main",
    scopePaths: [],
    owners: [],
    acceptanceCriteria: acceptance,
    validationCommands: ["bun run check:fast"],
    docs: [],
    riskTier,
    rawTask: row.errorMessage,
    labels: ["agent-gap", `kind:${row.kind}`, `severity:${row.severity}`],
    notes,
  };
}
