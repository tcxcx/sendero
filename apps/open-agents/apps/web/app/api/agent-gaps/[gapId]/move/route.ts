import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/session/get-server-session";
import { moveCardOnBoard } from "@/lib/agent-gaps/mutations";

const bodySchema = z.object({
  toColumn: z.enum(["open", "triaged", "in_progress", "resolved", "wontfix"]),
  toPosition: z.number().int().min(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) {
  const session = await getServerSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { gapId } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await moveCardOnBoard({
      gapId,
      toColumn: parsed.data.toColumn,
      toPosition: parsed.data.toPosition,
    });
    return NextResponse.json({
      ok: true,
      dispatched: result.dispatched,
      sessionId: result.sessionId,
      dispatchError: result.dispatchError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
