import { Liveblocks, type WebhookEvent } from '@liveblocks/node';
import { parseRoomId } from '@sendero/collaboration/server';
import { type Prisma, prisma } from '@sendero/database';

const SUPPORT_AGENT_ID = 'agent:customer-support';

type FanoutResult = {
  handled: boolean;
  roomId: string | null;
  channels: string[];
};

export async function fanoutLiveblocksWebhookEvent(event: WebhookEvent): Promise<FanoutResult> {
  const roomId = roomIdFromEvent(event);
  if (!roomId) return { handled: false, roomId: null, channels: [] };

  const parsed = parseRoomId(roomId);
  if (!parsed) return { handled: false, roomId, channels: [] };

  const channels = channelsForEvent(event);
  if (parsed.kind === 'trip') {
    await appendTripCollaborationEvent({
      tenantId: parsed.tenantId,
      tripId: parsed.tripId,
      event,
      channels,
    });
  }

  if (isOperatorRelevant(event)) {
    await triggerSupportAgentNotification({
      roomId,
      event,
      tenantId: parsed.tenantId,
    });
  }

  return { handled: true, roomId, channels };
}

function roomIdFromEvent(event: WebhookEvent): string | null {
  const data = event.data as { roomId?: string | null };
  return typeof data.roomId === 'string' ? data.roomId : null;
}

function channelsForEvent(event: WebhookEvent): string[] {
  if (event.type === 'notification') {
    return ['app', 'slack', 'whatsapp', 'support_agent'];
  }
  if (
    event.type === 'commentCreated' ||
    event.type === 'threadCreated' ||
    event.type === 'threadMarkedAsResolved' ||
    event.type === 'threadMarkedAsUnresolved'
  ) {
    return ['app', 'support_agent'];
  }
  return ['app'];
}

function isOperatorRelevant(event: WebhookEvent): boolean {
  return (
    event.type === 'commentCreated' ||
    event.type === 'threadCreated' ||
    event.type === 'threadMarkedAsUnresolved' ||
    event.type === 'notification'
  );
}

async function appendTripCollaborationEvent(args: {
  tenantId: string;
  tripId: string;
  event: WebhookEvent;
  channels: string[];
}) {
  const trip = await prisma.trip.findFirst({
    where: { id: args.tripId, tenantId: args.tenantId },
    select: { id: true, events: true },
  });
  if (!trip) return;

  const data = args.event.data as Record<string, unknown>;
  const entry = {
    id: `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'liveblocks_collaboration',
    eventType: args.event.type,
    roomId: roomIdFromEvent(args.event),
    threadId: typeof data.threadId === 'string' ? data.threadId : null,
    commentId: typeof data.commentId === 'string' ? data.commentId : null,
    inboxNotificationId:
      typeof data.inboxNotificationId === 'string' ? data.inboxNotificationId : null,
    channels: args.channels,
    status: 'received',
    createdAt: new Date().toISOString(),
  };

  const existing = Array.isArray(trip.events) ? (trip.events as Prisma.JsonArray) : [];
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      events: [...existing, entry] as Prisma.InputJsonValue,
    },
  });
}

async function triggerSupportAgentNotification(args: {
  roomId: string;
  tenantId: string;
  event: WebhookEvent;
}) {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return;
  const liveblocks = new Liveblocks({ secret });
  const data = args.event.data as Record<string, unknown>;
  const threadId = typeof data.threadId === 'string' ? data.threadId : 'thread';
  await liveblocks.triggerInboxNotification({
    userId: SUPPORT_AGENT_ID,
    kind: '$handoffRequired',
    subjectId: `${args.roomId}:${threadId}`,
    roomId: args.roomId,
    activityData: {
      title: 'Customer support attention needed',
      message: `Liveblocks ${args.event.type} received for ${threadId}`,
      provider: 'liveblocks',
      url: urlForRoom(args.roomId),
    },
  });
}

function urlForRoom(roomId: string): string {
  const parsed = parseRoomId(roomId);
  if (!parsed) return '/dashboard';
  if (parsed.kind === 'trip') return `/dashboard/trips/${parsed.tripId}`;
  if (parsed.kind === 'support') return '/dashboard/inbox';
  return '/dashboard';
}
