import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getBoardState } from "@/lib/agent-gaps/queries";
import { AgentGapsBoardClient } from "./agent-gaps-board-client";

export const metadata: Metadata = {
  title: "Agent Gaps",
  description:
    "Self-reported failures the minion files when it gets stuck. Drag a card to In Progress to dispatch a self-heal run.",
};

export const dynamic = "force-dynamic";

export default async function AgentGapsPage() {
  const session = await getServerSession();
  if (!session) redirect("/get-started");

  const board = await getBoardState();
  return <AgentGapsBoardClient initialBoard={board} />;
}
