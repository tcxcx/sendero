/**
 * /dashboard/handoffs — AI escalation queue.
 *
 * Surfaces every `ChannelHandoff` row queued by the agent's
 * `request_human_handoff` tool. Operators answer inline; on submit,
 * the answer routes back to the originating channel via
 * `/api/internal/handoffs/[id]/resolve`.
 *
 * Distinct from `/dashboard/handoff` (singular) which is the
 * `support_tickets` reconciliation surface for general escalations.
 * This page is specifically for agent-initiated questions where the AI
 * paused mid-conversation and asked the team for input.
 */

import Link from 'next/link';

import { prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { HandoffAnswerForm } from '@/components/handoffs/handoff-answer-form';

export const dynamic = 'force-dynamic';

export default async function HandoffsPage() {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();

  const rows = await prisma.channelHandoff.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 60,
    select: {
      id: true,
      tripId: true,
      channel: true,
      question: true,
      summary: true,
      status: true,
      answer: true,
      createdAt: true,
      answeredAt: true,
      channelIdentity: {
        select: { externalUserId: true, username: true },
      },
    },
  });

  const pending = rows.filter(r => r.status === 'pending');
  const answered = rows.filter(r => r.status !== 'pending');

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <header>
        <h1 className="t-h1">AI handoffs</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Sendero pings here whenever the agent isn't confident enough to answer alone. Reply
          inline; the answer routes back to the traveler on the originating channel.
        </p>
      </header>

      {pending.length === 0 ? (
        <section
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '16px' }}
        >
          <div className="t-meta">No pending handoffs</div>
          <p className="t-body ink-70" style={{ marginTop: 8, fontSize: 13 }}>
            When the agent escalates next, the question lands here and pings your Liveblocks inbox.
          </p>
        </section>
      ) : (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="t-meta">Pending · {pending.length}</div>
          {pending.map(row => (
            <article
              key={row.id}
              className="sd-card-flat"
              style={{
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                padding: '14px 16px',
                display: 'grid',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div className="t-meta" style={{ textTransform: 'uppercase' }}>
                    {row.channel}
                    {row.channelIdentity?.externalUserId
                      ? ` · ${row.channelIdentity.externalUserId}`
                      : ''}
                  </div>
                  <h2
                    className="t-body"
                    style={{ marginTop: 6, fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}
                  >
                    {row.question}
                  </h2>
                  {row.summary ? (
                    <p
                      className="t-body ink-70"
                      style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}
                    >
                      {row.summary}
                    </p>
                  ) : null}
                </div>
                <div className="t-meta" style={{ whiteSpace: 'nowrap' }}>
                  {timeAgo(row.createdAt)}
                </div>
              </div>
              {row.tripId ? (
                <Link
                  href={`/dashboard/inbox/${row.tripId}`}
                  className="t-meta"
                  style={{ textDecoration: 'underline' }}
                >
                  Open trip inbox
                </Link>
              ) : null}
              <HandoffAnswerForm handoffId={row.id} />
            </article>
          ))}
        </section>
      )}

      {answered.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
          <div className="t-meta">Recently answered</div>
          {answered.slice(0, 12).map(row => (
            <article
              key={row.id}
              className="sd-card-flat"
              style={{
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                padding: '12px 14px',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div className="t-meta" style={{ textTransform: 'uppercase' }}>
                  {row.channel} · {row.status}
                </div>
                <div className="t-meta">{timeAgo(row.answeredAt ?? row.createdAt)}</div>
              </div>
              <div className="t-body" style={{ fontSize: 13, lineHeight: 1.45 }}>
                <span className="ink-70">Q:</span> {row.question}
              </div>
              {row.answer ? (
                <div className="t-body" style={{ fontSize: 13, lineHeight: 1.45 }}>
                  <span className="ink-70">A:</span> {row.answer}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
