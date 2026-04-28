/**
 * /dashboard/channels/whatsapp/inbox — operator-facing audit surface.
 *
 * Three stacked tables, all tenant-scoped:
 *   1. Inbound webhook events  — every Meta webhook delivery, with
 *      verify outcome + normalized counts + duration.
 *   2. Outbound API calls      — every Kapso/Meta call, with status,
 *      duration, error message.
 *   3. Outbound messages       — every send (agent reply / OTP /
 *      security alert / etc.), with delivery status + failure reason.
 *
 * Closes Bucket 5 of the channel-skill audit. When a customer says
 * "the bot didn't reply," ops opens this page, eyeballs both tables,
 * and either sees the inbound (verify ok? dispatched > 0?) or the
 * outbound (delivery_status = failed? failure_reason populated?).
 *
 * Read-only by design — the audit is a witness, not a control plane.
 *
 * Visual shell mirrors `SlackConnectedPanel`'s Channel-routing card so
 * the audit pages on both channels read as one design system.
 */

import { prisma } from '@sendero/database';

import { InboxSectionCard } from '@/components/channels/inbox-section-card';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function WhatsAppInboxPage() {
  const { tenant } = await requireCurrentTenant();

  const [webhookEvents, outboundMessages, apiLogs] = await Promise.all([
    prisma.whatsAppWebhookEvent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { receivedAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.whatsAppOutboundMessage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sentAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.whatsAppApiLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { calledAt: 'desc' },
      take: PAGE_SIZE,
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
        <h1 className="t-h1">WhatsApp inbox audit</h1>
        <p className="t-body ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Every inbound webhook delivery and every outbound message we sent. Use this when a
          customer reports a missing reply or a stuck OTP.
        </p>
      </header>

      <InboxSectionCard
        id="inbound-heading"
        title="Inbound webhook deliveries"
        description="Newest-first · verify + normalized counts + duration"
        meta={`Last ${Math.min(webhookEvents.length, PAGE_SIZE)}`}
      >
        {webhookEvents.length === 0 ? (
          <EmptyState
            title="No inbound deliveries logged yet"
            body="Once Meta forwards a message to your webhook, the row lands here."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Received</Th>
                  <Th>Verify</Th>
                  <Th>Replay</Th>
                  <Th align="right">Msgs</Th>
                  <Th align="right">Statuses</Th>
                  <Th align="right">Disp.</Th>
                  <Th align="right">Drop·R</Th>
                  <Th align="right">Drop·D</Th>
                  <Th align="right">Duration</Th>
                  <Th>Trace</Th>
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map((ev, i) => {
                  const last = i === webhookEvents.length - 1;
                  return (
                    <tr key={ev.id} style={tableRowStyle(last)}>
                      <Td title={ev.receivedAt.toISOString()}>{formatRelative(ev.receivedAt)}</Td>
                      <Td>
                        <Badge tone={ev.signatureValid ? 'ok' : 'fail'}>
                          {ev.signatureValid ? 'ok' : 'bad'}
                        </Badge>
                      </Td>
                      <Td>
                        {ev.replayWindowOk === null ? (
                          <span className="ink-70">—</span>
                        ) : (
                          <Badge tone={ev.replayWindowOk ? 'ok' : 'warn'}>
                            {ev.replayWindowOk ? 'ok' : 'stale'}
                          </Badge>
                        )}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.messageCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.statusUpdateCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.dispatchedCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.droppedReplayCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.droppedDuplicateCount}
                      </Td>
                      <Td className="font-mono" align="right">
                        {ev.durationMs == null ? '—' : `${ev.durationMs}ms`}
                      </Td>
                      <Td className="font-mono">{ev.traceId?.slice(0, 8) ?? '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </InboxSectionCard>

      <InboxSectionCard
        id="api-heading"
        title="Outbound API calls"
        description="Newest-first · Kapso + Meta"
        meta={`Last ${Math.min(apiLogs.length, PAGE_SIZE)}`}
      >
        {apiLogs.length === 0 ? (
          <EmptyState
            title="No API calls logged yet"
            body="Every Kapso health ping and Meta send (or failed attempt) lands here. Filter by failed-only to triage outages."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Called</Th>
                  <Th>Target</Th>
                  <Th>Method</Th>
                  <Th>Endpoint</Th>
                  <Th>Status</Th>
                  <Th align="right">Duration</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {apiLogs.map((log, i) => {
                  const last = i === apiLogs.length - 1;
                  return (
                    <tr key={log.id} style={tableRowStyle(last)}>
                      <Td title={log.calledAt.toISOString()}>{formatRelative(log.calledAt)}</Td>
                      <Td>
                        <span
                          className="font-mono"
                          style={{
                            display: 'inline-flex',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'color-mix(in oklab, var(--ink) 5%, transparent)',
                            fontSize: 11,
                          }}
                        >
                          {log.target}
                        </span>
                      </Td>
                      <Td className="font-mono">{log.method}</Td>
                      <Td className="font-mono text-[11px]" title={log.endpoint}>
                        {log.endpoint}
                      </Td>
                      <Td>
                        <Badge tone={log.ok ? 'ok' : 'fail'}>
                          {log.statusCode === 0 ? 'net' : log.statusCode}
                        </Badge>
                      </Td>
                      <Td className="font-mono" align="right">
                        {`${log.durationMs}ms`}
                      </Td>
                      <Td
                        className="max-w-[260px] truncate text-[11px]"
                        title={log.errorMessage ?? undefined}
                      >
                        {log.errorMessage ? (
                          <span className="text-rose-700">{log.errorMessage}</span>
                        ) : (
                          <span className="ink-70">—</span>
                        )}
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
        id="outbound-heading"
        title="Outbound messages"
        description="Newest-first · delivery status + failure reason"
        meta={`Last ${Math.min(outboundMessages.length, PAGE_SIZE)}`}
      >
        {outboundMessages.length === 0 ? (
          <EmptyState
            title="No outbound messages logged yet"
            body="Every send through `WhatsAppClient` lands here once an audit hook is wired in."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={tableHeadRowStyle}>
                  <Th>Sent</Th>
                  <Th>Source</Th>
                  <Th>Kind</Th>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th>Preview</Th>
                  <Th>Wamid</Th>
                </tr>
              </thead>
              <tbody>
                {outboundMessages.map((msg, i) => {
                  const last = i === outboundMessages.length - 1;
                  return (
                    <tr key={msg.id} style={tableRowStyle(last)}>
                      <Td title={msg.sentAt.toISOString()}>{formatRelative(msg.sentAt)}</Td>
                      <Td>
                        <span
                          className="font-mono"
                          style={{
                            display: 'inline-flex',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'color-mix(in oklab, var(--ink) 5%, transparent)',
                            fontSize: 11,
                          }}
                        >
                          {msg.source}
                        </span>
                      </Td>
                      <Td>{msg.kind}</Td>
                      <Td className="font-mono">{redactRecipient(msg.recipientId)}</Td>
                      <Td>
                        <DeliveryStatusBadge
                          status={msg.deliveryStatus}
                          failureReason={msg.failureReason}
                        />
                      </Td>
                      <Td className="max-w-[260px] truncate" title={msg.preview ?? undefined}>
                        {msg.preview ?? <span className="ink-70">—</span>}
                      </Td>
                      <Td className="font-mono text-[11px]" title={msg.wamid}>
                        {msg.wamid.slice(-12)}
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

function DeliveryStatusBadge({
  status,
  failureReason,
}: {
  status: string;
  failureReason: string | null;
}) {
  const tone: 'ok' | 'warn' | 'fail' =
    status === 'failed' ? 'fail' : status === 'sent' ? 'warn' : 'ok';
  return (
    <span title={failureReason ?? undefined}>
      <Badge tone={tone}>{status}</Badge>
    </span>
  );
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

/** Minimal-PII E.164 / BSUID redaction — hide the middle digits. */
function redactRecipient(id: string): string {
  if (id.length <= 6) return id;
  return `${id.slice(0, 4)}…${id.slice(-3)}`;
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
