import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import { getBoardState } from "@/lib/agent-gaps/queries";

export async function GET() {
  const session = await getServerSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const board = await getBoardState();
    return NextResponse.json({ board });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
