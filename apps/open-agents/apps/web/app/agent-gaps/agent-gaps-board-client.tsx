"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  KanbanColumn,
  KanbanItem,
  KanbanRoot,
  KanbanSortableContext,
} from "@/components/agent-gaps/kanban";
import type { KnowledgeGap, KnowledgeGapStatus } from "@/lib/db/schema";
import { AgentGapCard } from "./agent-gap-card";
import { AgentGapDetailSheet } from "./agent-gap-detail-sheet";

type Board = Record<KnowledgeGapStatus, KnowledgeGap[]>;

const COLUMN_ORDER: KnowledgeGapStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "resolved",
  "wontfix",
];

const COLUMN_TITLES: Record<KnowledgeGapStatus, string> = {
  open: "Backlog",
  triaged: "Review",
  in_progress: "In Progress",
  resolved: "Done",
  wontfix: "Won't Fix",
};

const COLUMN_ACCENTS: Record<
  KnowledgeGapStatus,
  "default" | "success" | "warning" | "danger"
> = {
  open: "warning",
  triaged: "default",
  in_progress: "default",
  resolved: "success",
  wontfix: "danger",
};

export function AgentGapsBoardClient({
  initialBoard,
}: {
  initialBoard: Board;
}) {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [selected, setSelected] = useState<KnowledgeGap | null>(null);

  const totalOpen =
    board.open.length + board.triaged.length + board.in_progress.length;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/agent-gaps");
    if (!res.ok) return;
    const data = (await res.json()) as { board: Board };
    setBoard(data.board);
  }, []);

  const onMove = useCallback(
    async (params: {
      cardId: string;
      fromColumn: string;
      toColumn: string;
      toIndex: number;
    }) => {
      // Optimistic update
      setBoard((prev) => {
        const next: Board = {
          open: [...prev.open],
          triaged: [...prev.triaged],
          in_progress: [...prev.in_progress],
          resolved: [...prev.resolved],
          wontfix: [...prev.wontfix],
        };
        const from = params.fromColumn as KnowledgeGapStatus;
        const to = params.toColumn as KnowledgeGapStatus;
        const idx = next[from].findIndex((r) => r.id === params.cardId);
        if (idx === -1) return prev;
        const [card] = next[from].splice(idx, 1);
        if (!card) return prev;
        next[to].splice(Math.min(params.toIndex, next[to].length), 0, {
          ...card,
          boardColumn: to,
        });
        return next;
      });

      const res = await fetch(`/api/agent-gaps/${params.cardId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toColumn: params.toColumn,
          toPosition: params.toIndex,
        }),
      });
      if (!res.ok) {
        toast.error("Move failed — refreshing");
        await refresh();
        return;
      }
      const data = (await res.json()) as {
        dispatched: boolean;
        sessionId?: string;
        dispatchError?: string;
      };
      if (data.dispatched && data.sessionId) {
        toast.success(`Minion dispatched: ${data.sessionId.slice(0, 8)}`);
      } else if (data.dispatchError) {
        toast.error(`Dispatch failed: ${data.dispatchError}`);
      }
    },
    [refresh],
  );

  const onAutoExecuteToggle = useCallback(
    async (gapId: string, enabled: boolean) => {
      setBoard((prev) => {
        const next: Board = {
          open: prev.open.map((r) =>
            r.id === gapId ? { ...r, autoExecuteOnInProgress: enabled } : r,
          ),
          triaged: prev.triaged.map((r) =>
            r.id === gapId ? { ...r, autoExecuteOnInProgress: enabled } : r,
          ),
          in_progress: prev.in_progress.map((r) =>
            r.id === gapId ? { ...r, autoExecuteOnInProgress: enabled } : r,
          ),
          resolved: prev.resolved.map((r) =>
            r.id === gapId ? { ...r, autoExecuteOnInProgress: enabled } : r,
          ),
          wontfix: prev.wontfix.map((r) =>
            r.id === gapId ? { ...r, autoExecuteOnInProgress: enabled } : r,
          ),
        };
        return next;
      });
      const res = await fetch(`/api/agent-gaps/${gapId}/auto-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        toast.error("Toggle failed — refreshing");
        await refresh();
      } else {
        toast(enabled ? "Auto-execute on" : "Auto-execute off");
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted">
            <Sparkles className="h-5 w-5 text-violet-500" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-bold">Agent Gaps</h1>
            <p className="text-xs text-muted-foreground">
              Self-reported minion failures. Drag a card to In Progress to
              dispatch a self-heal run.
            </p>
          </div>
          <div className="ml-auto inline-flex items-center gap-2 rounded-md border bg-muted px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              Open
            </span>
            <span className="text-sm font-bold tabular-nums text-violet-500">
              {totalOpen}
            </span>
          </div>
        </div>
      </header>

      <div className="p-4">
        <KanbanRoot<KnowledgeGap>
          columns={board}
          getItemValue={(r) => r.id}
          onMove={onMove}
          renderOverlay={(card) => (
            <div className="w-[296px] rounded-lg border border-violet-500 bg-background p-3 shadow-md">
              <p className="line-clamp-2 text-sm font-semibold">
                {card.hypothesis}
              </p>
            </div>
          )}
        >
          {COLUMN_ORDER.map((col) => {
            const cards = board[col];
            return (
              <KanbanColumn
                key={col}
                id={col}
                title={COLUMN_TITLES[col]}
                count={cards.length}
                accent={COLUMN_ACCENTS[col]}
              >
                <KanbanSortableContext items={cards.map((c) => c.id)}>
                  {cards.map((row) => (
                    <KanbanItem key={row.id} id={row.id}>
                      <AgentGapCard
                        row={row}
                        onSelect={setSelected}
                        onAutoExecuteToggle={onAutoExecuteToggle}
                      />
                    </KanbanItem>
                  ))}
                </KanbanSortableContext>
                {cards.length === 0 && (
                  <div className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                    Drop cards here
                  </div>
                )}
              </KanbanColumn>
            );
          })}
        </KanbanRoot>
      </div>

      <AgentGapDetailSheet
        row={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
