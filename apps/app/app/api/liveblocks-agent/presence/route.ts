import { type NextRequest, NextResponse } from 'next/server';

import { parseRoomId, setAgentPresence } from '@sendero/collaboration/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

type PresenceBody = {
  roomId?: string;
  agentId?: string;
  status?: 'thinking' | 'acting' | 'blocked' | 'idle';
  focusedSection?: string;
  focusLabel?: string;
  runStep?: string;
  ttl?: number;
};

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.SENDERO_AGENT_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: 'agent_presence_not_configured' }, { status: 503 });
  }
  if (req.headers.get('x-sendero-agent-secret') !== configuredSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PresenceBody | null;
  if (!body?.roomId || !body.agentId) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const parsed = parseRoomId(body.roomId);
  if (!parsed) return NextResponse.json({ error: 'invalid_room' }, { status: 400 });

  await setAgentPresence({
    roomId: body.roomId,
    userId: body.agentId,
    data: {
      status: body.status ?? 'thinking',
      focusedSection: body.focusedSection ?? null,
      focusLabel: body.focusLabel ?? null,
      runStep: body.runStep ?? null,
      tripId: parsed.kind === 'trip' ? parsed.tripId : null,
    },
    userInfo: agentInfo(body.agentId),
    ttl: body.ttl,
  });

  return NextResponse.json({ ok: true });
}

function agentInfo(agentId: string) {
  if (agentId === 'agent:customer-support') {
    return { name: 'Customer Support Agent', color: '#1f7a69' };
  }
  if (agentId === 'agent:safety-reviewer') {
    return { name: 'Safety Reviewer Agent', color: '#9a3f72' };
  }
  if (agentId === 'agent:reservation-operator') {
    return { name: 'Reservation Operator Agent', color: '#375a9e' };
  }
  return { name: 'Travel Planner Agent', color: '#cc4b37' };
}
