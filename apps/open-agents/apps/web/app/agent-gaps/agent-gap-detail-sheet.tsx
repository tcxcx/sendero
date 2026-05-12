"use client";

import { ExternalLink, GitPullRequest } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { KnowledgeGap } from "@/lib/db/schema";

interface Props {
  row: KnowledgeGap | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentGapDetailSheet({ row, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        {row && (
          <div className="flex flex-col gap-4 overflow-y-auto p-4 pr-2">
            <SheetHeader className="text-left">
              <SheetTitle className="text-base font-bold">
                {row.kind.replace(/_/g, " ")}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                gap {row.id.slice(0, 8)} · {row.severity} ·{" "}
                {row.occurrenceCount}× occurrence
              </SheetDescription>
            </SheetHeader>

            <Section title="Hypothesis">
              <p className="text-sm">{row.hypothesis}</p>
            </Section>

            <Section title="Error message">
              <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-[11px] text-muted-foreground">
                {row.errorMessage}
              </pre>
            </Section>

            {row.toolName && (
              <Section title="Attempted tool">
                <code className="rounded-md border bg-muted px-2 py-1 font-mono text-[11px]">
                  {row.toolName}
                </code>
              </Section>
            )}

            {row.fixSummary && (
              <Section title="Known fix">
                <p className="text-sm">{row.fixSummary}</p>
              </Section>
            )}

            {row.mustMention.length > 0 && (
              <Section title="Must mention">
                <div className="flex flex-wrap gap-1">
                  {row.mustMention.map((token) => (
                    <span
                      key={token}
                      className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-500"
                    >
                      {token}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <div className="flex flex-wrap gap-2">
              {row.prUrl && (
                <a
                  href={row.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted"
                >
                  <GitPullRequest className="h-3 w-3" />
                  Last blocking PR
                </a>
              )}
              {row.resolutionPrUrl && (
                <a
                  href={row.resolutionPrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted"
                >
                  <GitPullRequest className="h-3 w-3" />
                  Resolution PR
                </a>
              )}
              {row.linearIssueId && (
                <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold">
                  <ExternalLink className="h-3 w-3" />
                  {row.linearIssueId}
                </span>
              )}
            </div>

            {row.lastExecutionSessionId && (
              <Section title="Last execution">
                <p className="font-mono text-[11px] text-muted-foreground">
                  session {row.lastExecutionSessionId.slice(0, 12)} ·{" "}
                  <span className="font-semibold">
                    {row.lastExecutionStatus ?? "pending"}
                  </span>
                </p>
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}
