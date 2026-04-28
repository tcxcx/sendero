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
    <main className="mx-auto w-full max-w-screen-xl space-y-8 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Slack inbox audit</h1>
        <p className="text-sm text-muted-foreground">
          Every agent turn we ran for a Slack message and the install state behind it. Use this
          when a customer reports a missing reply or a workspace that stopped responding.
        </p>
      </header>

      <section aria-labelledby="turns-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="turns-heading" className="text-lg font-medium">
            Agent turns
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.min(agentTurns.length, PAGE_SIZE)} of newest-first · derived from MeterEvent
          </p>
        </div>
        {agentTurns.length === 0 ? (
          <EmptyState
            title="No Slack agent turns logged yet"
            body="Once a workspace member messages the bot in a connected channel, the meter row lands here."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>Ran</Th>
                  <Th>Tool</Th>
                  <Th>Status</Th>
                  <Th>Price (µUSDC)</Th>
                  <Th>Turn</Th>
                  <Th>User</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {agentTurns.map(t => {
                  const meta = (t.metadata && typeof t.metadata === 'object'
                    ? (t.metadata as Record<string, unknown>)
                    : {}) as Record<string, unknown>;
                  const turnId = typeof meta.turnId === 'string' ? meta.turnId : '—';
                  return (
                    <tr key={t.id} className="border-t border-border">
                      <Td title={t.at.toISOString()}>{formatRelative(t.at)}</Td>
                      <Td className="font-mono">{t.toolName}</Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td className="font-mono">{t.priceMicroUsdc.toString()}</Td>
                      <Td className="font-mono text-[11px]" title={turnId}>
                        {turnId.slice(0, 12)}
                      </Td>
                      <Td className="font-mono text-[11px]">{t.userId?.slice(-8) ?? '—'}</Td>
                      <Td
                        className="max-w-[260px] truncate text-[11px]"
                        title={t.note ?? undefined}
                      >
                        {t.note ?? <span className="text-muted-foreground">—</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="installs-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="installs-heading" className="text-lg font-medium">
            Connected installs
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.min(installs.length, PAGE_SIZE)} · revoked rows kept for audit
          </p>
        </div>
        {installs.length === 0 ? (
          <EmptyState
            title="No installs on this tenant yet"
            body="Connect a Slack workspace from the Workspace tab. Each install lands as a row here, even after revocation."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>Workspace</Th>
                  <Th>Team ID</Th>
                  <Th>Bot user</Th>
                  <Th>State</Th>
                  <Th>Installed</Th>
                  <Th>Scope</Th>
                </tr>
              </thead>
              <tbody>
                {installs.map(i => (
                  <tr key={i.id} className="border-t border-border">
                    <Td>
                      <div className="space-y-0.5">
                        <div>{i.teamName}</div>
                        {i.enterpriseName ? (
                          <div className="text-[10px] text-muted-foreground">
                            Grid · {i.enterpriseName}
                          </div>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

// ─── tiny presentational helpers ─────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-3 py-2 align-top ${className ?? ''}`} title={title}>
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
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
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
