"use client";

import { ExternalLink, GitPullRequest, RefreshCcw, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { KnowledgeGap, KnowledgeGapSeverity } from "@/lib/db/schema";

interface Props {
  row: KnowledgeGap;
  onSelect?: (row: KnowledgeGap) => void;
  onAutoExecuteToggle: (gapId: string, enabled: boolean) => void;
}

function severityClass(severity: KnowledgeGapSeverity): string {
  switch (severity) {
    case "critical":
      return "border-rose-500 bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
    case "high":
      return "border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300";
    case "medium":
      return "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "border-muted-foreground/30 bg-muted text-muted-foreground";
  }
}

function severityLabel(severity: KnowledgeGapSeverity): string {
  switch (severity) {
    case "critical":
      return "🚨 critical";
    case "high":
      return "⚠️ high";
    case "medium":
      return "🛠 medium";
    default:
      return "📦 low";
  }
}

export function AgentGapCard({ row, onSelect, onAutoExecuteToggle }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onSelect?.(row)}
        className="text-left"
        aria-label={`Open details for ${row.kind} gap`}
      >
        <p className="line-clamp-2 text-sm font-semibold">{row.hypothesis}</p>
        {row.toolName && (
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {row.toolName}
          </p>
        )}
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${severityClass(
            row.severity,
          )}`}
        >
          {severityLabel(row.severity)}
        </span>
        <span className="inline-flex items-center rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {row.kind.replace(/_/g, " ")}
        </span>
        {row.occurrenceCount > 1 && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-500">
            <RefreshCcw className="h-3 w-3" />×{row.occurrenceCount}
          </span>
        )}
        {row.prUrl && (
          <a
            href={row.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-semibold hover:bg-muted"
            onClick={(e) => e.stopPropagation()}
          >
            <GitPullRequest className="h-3 w-3" />
            PR
          </a>
        )}
        {row.linearIssueId && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-semibold">
            <ExternalLink className="h-3 w-3" />
            {row.linearIssueId}
          </span>
        )}
      </div>

      <div
        className="flex items-center justify-between border-t pt-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Zap className="h-3 w-3 text-violet-500" />
          Auto-execute
        </span>
        <Switch
          checked={row.autoExecuteOnInProgress}
          onCheckedChange={(checked) => onAutoExecuteToggle(row.id, checked)}
          aria-label="Toggle auto-execute on this gap"
        />
      </div>

      {row.lastExecutionStatus && (
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          last run:{" "}
          <span className="font-semibold">{row.lastExecutionStatus}</span>
        </p>
      )}
    </div>
  );
}
