/**
 * TripChannelLanes — three-column summary strip above MetaInboxLive
 * that shows operator-at-a-glance status across Slack / WhatsApp / Web
 * for one corporate trip.
 *
 * Phase 3 Tier 4. Per the customer_account_slack_install architecture
 * memory, B2B2B trips span three channels with three audiences:
 *   - Slack lane (purple) — corporate-customer workspace messages
 *     from the employee + Sendero replies inside their company Slack.
 *   - WhatsApp lane (green) — the same employee's personal-phone trip
 *     thread (boarding pass, balance, claim links).
 *   - Web lane (vermillion) — TMC operator interventions, agent
 *     reasoning, handoff approvals.
 *
 * For each lane: a header chip with the channel + a recent-event
 * summary card. Empty lanes show a "no activity" hint so the operator
 * sees the cross-channel topology even before the first message lands.
 *
 * Reads existing tables: ChannelIdentity (which channels are linked
 * to this trip's traveler), ChannelHandoff (escalations + approvals),
 * WhatsAppOutboundMessage (outbound WA sends), SlackAgentEvent
 * (Slack thread context). Falls back to "no recent activity" when
 * the table is empty rather than spinning up new schema.
 */

import { prisma } from '@sendero/database';

interface TripChannelLanesProps {
  tenantId: string;
  tripId: string;
}

type LaneKind = 'slack' | 'whatsapp' | 'web';

interface LanePreview {
  kind: LaneKind;
  label: string;
  identifier: string | null;
  lastEvent: { kind: string; ts: Date; summary: string } | null;
  count: number;
}

const LANE_COPY: Record<LaneKind, { label: string; tint: string; emoji: string; lede: string }> = {
  slack: {
    label: 'Slack',
    tint: 'color-mix(in oklab, #6b46c1 9%, transparent)',
    emoji: '🟣',
    lede: 'Corporate-customer workspace',
  },
  whatsapp: {
    label: 'WhatsApp',
    tint: 'color-mix(in oklab, #1f8a4a 9%, transparent)',
    emoji: '🟢',
    lede: 'Traveler personal phone',
  },
  web: {
    label: 'Web',
    tint: 'color-mix(in oklab, #fb542b 9%, transparent)',
    emoji: '🟠',
    lede: 'TMC operator',
  },
};

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export async function TripChannelLanes({ tenantId, tripId }: TripChannelLanesProps) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId },
    select: { travelerId: true },
  });
  if (!trip) return null;

  // Resolve which channels are linked to the trip's traveler. A trip
  // bound to a corporate employee will typically have BOTH a Slack
  // identity (from the corporate workspace install) AND a WhatsApp
  // identity (from the traveler's personal phone) — the canonical
  // B2B2B cross-channel case. Direct consumers may have just one.
  const channelIdentities = trip.travelerId
    ? await prisma.channelIdentity.findMany({
        where: { tenantId, userId: trip.travelerId },
        select: { kind: true, externalUserId: true, username: true },
      })
    : [];

  // Latest channel-scoped events. Cheap parallel reads.
  // WhatsAppOutboundMessage has no tripId column — outbound WA sends
  // are keyed by recipientId (E.164 or BSUID), so trip-scoped WA
  // counts require a join through ChannelIdentity. Punt on that for
  // Tier 4 minimum: the WA lane shows "active" / "not linked" via
  // ChannelIdentity presence; we count handoffs that fanned to WA
  // as a proxy for activity.
  const waIdentity = channelIdentities.find(c => c.kind === 'whatsapp');
  const [slackLast, handoffLast, slackCount, handoffCount] = await Promise.all([
    prisma.slackAgentEvent.findFirst({
      where: { tenantId, tripId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, kind: true },
    }),
    prisma.channelHandoff.findFirst({
      where: { tenantId, tripId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, kind: true, status: true, question: true, channel: true },
    }),
    prisma.slackAgentEvent.count({ where: { tenantId, tripId } }),
    prisma.channelHandoff.count({ where: { tenantId, tripId } }),
  ]);
  // Count handoffs whose channel was WhatsApp as a cheap WA-activity
  // proxy. Direct WA message count needs the ChannelIdentity join
  // — left as a TODO follow-up.
  const waHandoffCount = waIdentity
    ? await prisma.channelHandoff.count({
        where: { tenantId, tripId, channel: 'whatsapp' },
      })
    : 0;

  const lanes: LanePreview[] = [
    {
      kind: 'slack',
      label: 'Slack',
      identifier:
        channelIdentities.find(c => c.kind === 'slack')?.username ??
        channelIdentities.find(c => c.kind === 'slack')?.externalUserId ??
        null,
      lastEvent: slackLast
        ? { kind: slackLast.kind, ts: slackLast.createdAt, summary: slackLast.kind }
        : null,
      count: slackCount,
    },
    {
      kind: 'whatsapp',
      label: 'WhatsApp',
      identifier: waIdentity?.externalUserId ?? waIdentity?.username ?? null,
      // No direct WA-message-per-trip query (schema requires
      // ChannelIdentity join). Show identity presence + handoff count
      // as a proxy. Replace with a full WA timeline view post-Tier 4.
      lastEvent: null,
      count: waHandoffCount,
    },
    {
      kind: 'web',
      label: 'Web',
      // Operator handoffs + approvals are surfaced here. No
      // ChannelIdentity to show — the web lane is the TMC operator
      // surface, not a traveler-facing channel.
      identifier: null,
      lastEvent: handoffLast
        ? {
            kind: handoffLast.kind ?? 'handoff',
            ts: handoffLast.createdAt,
            summary: handoffLast.question,
          }
        : null,
      count: handoffCount,
    },
  ];

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
        marginBottom: 12,
      }}
    >
      {lanes.map(lane => {
        const meta = LANE_COPY[lane.kind];
        return (
          <article
            key={lane.kind}
            style={{
              padding: 12,
              border: '1px solid var(--hairline-color, #d8c1a7)',
              borderRadius: 10,
              background: meta.tint,
              display: 'grid',
              gap: 6,
              minHeight: 88,
            }}
          >
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                {meta.emoji} {meta.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-faint, #8a8f99)',
                }}
              >
                {lane.count > 0 ? `${lane.count} event${lane.count > 1 ? 's' : ''}` : 'no activity'}
              </span>
            </header>
            <div className="t-meta ink-60" style={{ fontSize: 11 }}>
              {lane.identifier ?? meta.lede}
            </div>
            {lane.lastEvent ? (
              <div
                className="t-body"
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ fontWeight: 600 }}>{lane.lastEvent.summary}</span>
                <span className="ink-60" style={{ fontSize: 10 }}>
                  {timeAgo(lane.lastEvent.ts)} ago
                </span>
              </div>
            ) : (
              <div className="ink-60" style={{ fontSize: 11, fontStyle: 'italic' }}>
                Waiting for first message
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
