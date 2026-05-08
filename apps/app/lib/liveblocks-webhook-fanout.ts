import { Liveblocks, type WebhookEvent } from '@liveblocks/node';
import { parseRoomId } from '@sendero/collaboration/server';
import { type Prisma, prisma } from '@sendero/database';
import { claimDispatchSlot } from '@sendero/notifications/dedup-slot';
import { dispatch } from '@sendero/notifications/dispatch';

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

  // Phase C-2 — mention.received fan-out. Liveblocks fires the bell
  // itself before this webhook lands, so the dedup slot is claimed
  // here on behalf of the built-in bell. The parallel dispatcher's
  // liveblocks_bell adapter P2002s and skips, but its slack adapter
  // still fires per-recipient DMs (new behavior). Locked
  // /plan-eng-review E5/E8.
  await dispatchMentionReceived({
    tenantId: parsed.tenantId,
    tripId: parsed.kind === 'trip' ? parsed.tripId : null,
    event,
  });

  return { handled: true, roomId, channels };
}

async function dispatchMentionReceived(args: {
  tenantId: string;
  tripId: string | null;
  event: WebhookEvent;
}): Promise<void> {
  if (args.event.type !== 'notification') return;
  const data = args.event.data as {
    kind?: string;
    userId?: string;
    inboxNotificationId?: string;
    threadId?: string;
    roomId?: string | null;
  };
  if (data.kind !== 'thread' && data.kind !== 'textMention') return;
  if (!data.userId || data.userId.startsWith('agent:')) return; // synthetic, skip
  if (!data.inboxNotificationId) return;

  try {
    // Claim the bell slot on behalf of Liveblocks' built-in mention
    // bell (already fired by the time this webhook arrives). Dispatcher
    // hits P2002 and skips its own bell — exactly one bell per mention.
    await claimDispatchSlot({
      tenantId: args.tenantId,
      eventKind: 'mention.received',
      sourceKind: 'webhook',
      sourceId: data.inboxNotificationId,
      recipientUserId: data.userId,
      recipientReason: data.kind,
      channelKind: 'liveblocks_bell',
      triggeredBy: 'legacy:liveblocks-built-in-bell',
    });

    const url = args.tripId
      ? `/dashboard/console?tripId=${encodeURIComponent(args.tripId)}`
      : '/dashboard';

    await dispatch({
      event: {
        kind: 'mention.received',
        sourceId: data.inboxNotificationId,
        sourceKind: 'webhook',
        tripId: args.tripId ?? undefined,
        data: {
          title: 'You were mentioned',
          message:
            data.kind === 'textMention'
              ? 'A teammate mentioned you in a document'
              : 'A teammate mentioned you in a thread',
          url,
          threadId: data.threadId,
        },
      },
      recipients: [{ userId: data.userId, reason: data.kind }],
      context: {
        tenantId: args.tenantId,
        triggeredBy: 'webhook:liveblocks',
      },
    });
  } catch (err) {
    console.warn('[liveblocks-webhook-fanout] mention.received dispatch failed', {
      tenantId: args.tenantId,
      inboxNotificationId: data.inboxNotificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
