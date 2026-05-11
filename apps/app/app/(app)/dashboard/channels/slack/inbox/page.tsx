/**
 * /dashboard/channels/slack/inbox — operator-facing audit surface.
 *
 * Slack lacks the per-event tables WhatsApp has (`SlackWebhookEvent` /
 * `SlackOutboundMessage` / `SlackApiLog` aren't shipped yet). Until
 * they land we render the next-best evidence stream the operator
 * needs to triage "the bot didn't reply":
 *
 *   1. Slack agent turns — `MeterEvent` rows with `metadata.channel =
 *      'slack'`. One row per turn the agent dispatched on a Slack
 *      message. Status (paid / sandbox / rejected) shows whether the
 *      cap fired or the turn settled cleanly.
 *   2. Connected installs — `SlackInstall` rows with revoke state and
 *      bot identity. When `revokedAt` is set the install is dead and
 *      every webhook handler drops traffic.
 *
 * Read-only by design. The real per-event audit lands when we mirror
 * the WhatsApp ledger tables for Slack (separate task).
 */

import { prisma } from '@sendero/database';

import { InboxSectionCard } from '@/components/channels/inbox-section-card';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SlackAgentAuditRow = {
  id: string;
  createdAt: Date;
  traceId: string | null;
  turnId: string | null;
  teamId: string;
  channelId: string;
  threadTs: string;
  sequence: number;
  kind: string;
  toolName: string | null;
  ok: boolean | null;
  durationMs: number | null;
  statusText: string | null;
  errorMessage: string | null;
};

type SlackWebhookAuditRow = {
  id: string;
  receivedAt: Date;
  traceId: string | null;
  eventId: string | null;
  eventType: string | null;
  channelId: string | null;
  threadTs: string | null;
  dispatchStatus: string;
  dispatchError: string | null;
  dispatchedCount: number;
  droppedDuplicateCount: number;
  droppedBusyCount: number;
  durationMs: number | null;
};

export default async function SlackInboxPage() {
  const { tenant } = await requireCurrentTenant();

  const [agentTurns, installs, agentEvents, webhookEvents] = await Promise.all([
    prisma.meterEvent.findMany({
      where: {
        tenantId: tenant.id,
        metadata: { path: ['channel'], equals: 'slack' },
      },
      orderBy: { at: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        at: true,
        toolName: true,
        status: true,
        priceMicroUsdc: true,
        note: true,
        metadata: true,
        userId: true,
      },
    }),
    prisma.slackInstall.findMany({
      where: { tenantId: tenant.id },
      orderBy: { installedAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        teamId: true,
        teamName: true,
        enterpriseName: true,
        botUserId: true,
        scope: true,
        installedAt: true,
        revokedAt: true,
      },
    }),
    loadSlackAgentEvents(tenant.id),
    loadSlackWebhookEvents(tenant.id),
  ]);

  return (
    <main
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <header style={{ paddingTop: 4 }}>
        <h1 className="t-h1">Slack inbox audit</h1>
        <p className="t-body ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Every agent turn we ran for a Slack message and the install state behind it. Use this when
          a customer reports a missing reply or a workspace that stopped responding.
        </p>
      </header>

      <InboxSectionCard
        id="agent-events-heading"
        title="Agent/tool timeline"
        description="Exact Slack turn sequence · tool start, finish, failure, slow markers"
        meta={`Last ${Math.min(agentEvents.length, PAGE_SIZE)}`}
      >
        {agentEvents.length === 0 ? (
          <EmptyState
            title="No Slack agent timeline rows yet"
            body="New Slack turns will write a row for every tool start, tool finish, failure, placeholder update, and final reply."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>When</Th>
                  <Th>Trace</Th>
                  <Th align="right">Seq</Th>
                  <Th>Kind</Th>
                  <Th>Tool</Th>
                  <Th>OK</Th>
                  <Th align="right">ms</Th>
                  <Th>Thread</Th>
                  <Th>Status / error</Th>
                </tr>
              </thead>
              <tbody>
                {agentEvents.map((e, i) => {
                  const last = i === agentEvents.length - 1;
                  const detail = e.errorMessage ?? e.statusText ?? '';
                  return (
                    <tr key={e.id} style={tableRowStyle(last)}>
                      <Td title={e.createdAt.toISOString()}>{formatRelative(e.createdAt)}</Td>
                      <Td className="font-mono text-[11px]" title={e.traceId ?? undefined}>
                        {e.traceId?.slice(0, 12) ?? '—'}
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.sequence}
                      </Td>
                      <Td>
                        <EventKindBadge kind={e.kind} />
                      </Td>
                      <Td className="font-mono text-[11px]">{e.toolName ?? '—'}</Td>
                      <Td>
                        {e.ok === null ? (
                          '—'
                        ) : e.ok ? (
                          <Badge tone="ok">ok</Badge>
                        ) : (
                          <Badge tone="fail">fail</Badge>
                        )}
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.durationMs ?? '—'}
                      </Td>
                      <Td className="font-mono text-[11px]" title={`${e.channelId}:${e.threadTs}`}>
                        {e.channelId.slice(-5)}:{e.threadTs.slice(0, 8)}
                      </Td>
                      <Td
                        className="max-w-[360px] truncate text-[11px]"
                        title={detail || undefined}
                      >
                        {detail || <span className="ink-70">—</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </InboxSectionCard>

      <InboxSectionCard
        id="webhooks-heading"
        title="Webhook deliveries"
        description="Slack Events API routing decisions"
        meta={`Last ${Math.min(webhookEvents.length, PAGE_SIZE)}`}
      >
        {webhookEvents.length === 0 ? (
          <EmptyState
            title="No Slack webhook audit rows yet"
            body="Incoming Slack Events API deliveries will show whether they dispatched, skipped, deduped, or hit a busy thread lock."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Received</Th>
                  <Th>Trace</Th>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th align="right">Dispatch</Th>
                  <Th align="right">Dupes</Th>
                  <Th align="right">Busy</Th>
                  <Th align="right">ms</Th>
                  <Th>Thread</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map((e, i) => {
                  const last = i === webhookEvents.length - 1;
                  return (
                    <tr key={e.id} style={tableRowStyle(last)}>
                      <Td title={e.receivedAt.toISOString()}>{formatRelative(e.receivedAt)}</Td>
                      <Td className="font-mono text-[11px]" title={e.traceId ?? undefined}>
                        {e.traceId?.slice(0, 12) ?? '—'}
                      </Td>
                      <Td className="font-mono text-[11px]" title={e.eventId ?? undefined}>
                        {e.eventType ?? '—'}
                      </Td>
                      <Td>
                        <DispatchBadge status={e.dispatchStatus} />
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.dispatchedCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.droppedDuplicateCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.droppedBusyCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {e.durationMs ?? '—'}
                      </Td>
                      <Td
                        className="font-mono text-[11px]"
                        title={
                          e.channelId && e.threadTs ? `${e.channelId}:${e.threadTs}` : undefined
                        }
                      >
                        {e.channelId && e.threadTs
                          ? `${e.channelId.slice(-5)}:${e.threadTs.slice(0, 8)}`
                          : '—'}
                      </Td>
                      <Td
                        className="max-w-[260px] truncate text-[11px]"
                        title={e.dispatchError ?? undefined}
                      >
                        {e.dispatchError ?? <span className="ink-70">—</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </InboxSectionCard>

      <InboxSectionCard
        id="turns-heading"
        title="Agent turns"
        description="Newest-first · derived from MeterEvent"
        meta={`Last ${Math.min(agentTurns.length, PAGE_SIZE)}`}
      >
        {agentTurns.length === 0 ? (
          <EmptyState
            title="No Slack agent turns logged yet"
            body="Once a workspace member messages the bot in a connected channel, the meter row lands here."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Ran</Th>
                  <Th>Tool</Th>
                  <Th>Status</Th>
                  <Th align="right">µUSDC</Th>
                  <Th align="right">USDC</Th>
                  <Th>Turn</Th>
                  <Th>User</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {agentTurns.map((t, i) => {
                  const meta = (
                    t.metadata && typeof t.metadata === 'object'
                      ? (t.metadata as Record<string, unknown>)
                      : {}
                  ) as Record<string, unknown>;
                  const turnId = typeof meta.turnId === 'string' ? meta.turnId : '—';
                  const last = i === agentTurns.length - 1;
                  return (
                    <tr key={t.id} style={tableRowStyle(last)}>
                      <Td title={t.at.toISOString()}>{formatRelative(t.at)}</Td>
                      <Td className="font-mono">{t.toolName}</Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td className="font-mono" align="right">
                        {t.priceMicroUsdc.toString()}
                      </Td>
                      <Td className="font-mono" align="right">
                        {formatUsdc(t.priceMicroUsdc)}
                      </Td>
                      <Td className="font-mono text-[11px]" title={turnId}>
                        {turnId.slice(0, 12)}
                      </Td>
                      <Td className="font-mono text-[11px]">{t.userId?.slice(-8) ?? '—'}</Td>
                      <Td
                        className="max-w-[260px] truncate text-[11px]"
                        title={t.note ?? undefined}
                      >
                        {t.note ?? <span className="ink-70">—</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </InboxSectionCard>

      <InboxSectionCard
        id="installs-heading"
        title="Connected installs"
        description="Revoked rows kept for audit"
        meta={`Last ${Math.min(installs.length, PAGE_SIZE)}`}
      >
        {installs.length === 0 ? (
          <EmptyState
            title="No installs on this tenant yet"
            body="Connect a Slack workspace from the Workspace tab. Each install lands as a row here, even after revocation."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Workspace</Th>
                  <Th>Team ID</Th>
                  <Th>Bot user</Th>
                  <Th>State</Th>
                  <Th>Installed</Th>
                  <Th>Scope</Th>
                </tr>
              </thead>
              <tbody>
                {installs.map((i, idx) => {
                  const last = idx === installs.length - 1;
                  return (
                    <tr key={i.id} style={tableRowStyle(last)}>
                      <Td>
                        <div className="space-y-0.5">
                          <div>{i.teamName}</div>
                          {i.enterpriseName ? (
                            <div className="text-[10px] ink-70">Grid · {i.enterpriseName}</div>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="font-mono text-[11px]">{i.teamId}</Td>
                      <Td className="font-mono text-[11px]">{i.botUserId}</Td>
                      <Td>
                        {i.revokedAt ? (
                          <Badge tone="fail">revoked</Badge>
                        ) : (
                          <Badge tone="ok">active</Badge>
                        )}
                      </Td>
                      <Td title={i.installedAt.toISOString()}>{formatRelative(i.installedAt)}</Td>
                      <Td className="max-w-[220px] truncate text-[11px]" title={i.scope}>
                        {i.scope}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </InboxSectionCard>
    </main>
  );
}

// ─── tiny presentational helpers ─────────────────────────────────────

const tableHeadRowStyle: React.CSSProperties = {
  background: 'color-mix(in oklab, var(--ink) 3%, transparent)',
  borderBottom: '1px solid var(--hairline-color-soft)',
};

function tableRowStyle(last: boolean): React.CSSProperties {
  return {
    borderBottom: last ? 'none' : '1px solid var(--hairline-color-soft)',
  };
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: 'auto' }}>{children}</div>;
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className="t-meta"
      style={{
        padding: '10px 24px',
        textAlign: align ?? 'left',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  title,
  align,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={`align-top ${className ?? ''}`}
      style={{ padding: '12px 24px', textAlign: align ?? 'left' }}
      title={title}
    >
      {children}
    </td>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'fail'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-100 text-emerald-900'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-rose-100 text-rose-900';
  return (
    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: 'ok' | 'warn' | 'fail' =
    status === 'rejected' ? 'fail' : status === 'sandbox' ? 'warn' : 'ok';
  return <Badge tone={tone}>{status}</Badge>;
}

function EventKindBadge({ kind }: { kind: string }) {
  const tone: 'ok' | 'warn' | 'fail' =
    kind === 'tool_failed' || kind === 'turn_failed' || kind === 'outbound_failed'
      ? 'fail'
      : kind === 'tool_slow'
        ? 'warn'
        : 'ok';
  return <Badge tone={tone}>{kind}</Badge>;
}

function DispatchBadge({ status }: { status: string }) {
  const tone: 'ok' | 'warn' | 'fail' =
    status === 'failed' || status === 'unknown_install'
      ? 'fail'
      : status === 'skipped' || status === 'duplicate' || status === 'busy'
        ? 'warn'
        : 'ok';
  return <Badge tone={tone}>{status}</Badge>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: '24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span className="t-body" style={{ fontSize: 13, color: 'var(--midnight)' }}>
        {title}
      </span>
      <span className="t-body ink-70" style={{ fontSize: 12 }}>
        {body}
      </span>
    </div>
  );
}

function formatRelative(at: Date): string {
  const diffMs = Date.now() - at.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** µUSDC → USDC, formatted with 4–6 fraction digits to keep alignment compact. */
function formatUsdc(microUsdc: bigint | number | string): string {
  const m =
    typeof microUsdc === 'bigint'
      ? Number(microUsdc)
      : typeof microUsdc === 'string'
        ? Number(microUsdc)
        : microUsdc;
  if (!Number.isFinite(m)) return '—';
  return (m / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

async function loadSlackAgentEvents(tenantId: string): Promise<SlackAgentAuditRow[]> {
  try {
    return await prisma.$queryRaw<SlackAgentAuditRow[]>`
      SELECT
        id,
        created_at AS "createdAt",
        trace_id AS "traceId",
        turn_id AS "turnId",
        team_id AS "teamId",
        channel_id AS "channelId",
        thread_ts AS "threadTs",
        sequence,
        kind,
        tool_name AS "toolName",
        ok,
        duration_ms AS "durationMs",
        status_text AS "statusText",
        error_message AS "errorMessage"
      FROM slack_agent_events
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC, sequence DESC
      LIMIT ${PAGE_SIZE}
    `;
  } catch (err) {
    console.warn('[slack-inbox] slack_agent_events unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function loadSlackWebhookEvents(tenantId: string): Promise<SlackWebhookAuditRow[]> {
  try {
    return await prisma.$queryRaw<SlackWebhookAuditRow[]>`
      SELECT
        id,
        received_at AS "receivedAt",
        trace_id AS "traceId",
        event_id AS "eventId",
        event_type AS "eventType",
        channel_id AS "channelId",
        thread_ts AS "threadTs",
        dispatch_status AS "dispatchStatus",
        dispatch_error AS "dispatchError",
        dispatched_count AS "dispatchedCount",
        dropped_duplicate_count AS "droppedDuplicateCount",
        dropped_busy_count AS "droppedBusyCount",
        duration_ms AS "durationMs"
      FROM slack_webhook_events
      WHERE tenant_id = ${tenantId}
      ORDER BY received_at DESC
      LIMIT ${PAGE_SIZE}
    `;
  } catch (err) {
    console.warn('[slack-inbox] slack_webhook_events unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
