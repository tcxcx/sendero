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

export default async function SlackInboxPage() {
  const { tenant } = await requireCurrentTenant();

  const [agentTurns, installs] = await Promise.all([
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
