/**
 * /dashboard/channels/whatsapp/inbox — operator-facing audit surface.
 *
 * Two stacked tables, both tenant-scoped:
 *   1. Inbound webhook events  — every Meta webhook delivery, with
 *      verify outcome + normalized counts + duration.
 *   2. Outbound messages       — every send (agent reply / OTP /
 *      security alert / etc.), with delivery status + failure reason.
 *
 * Closes Bucket 5 of the channel-skill audit. When a customer says
 * "the bot didn't reply," ops opens this page, eyeballs both tables,
 * and either sees the inbound (verify ok? dispatched > 0?) or the
 * outbound (delivery_status = failed? failure_reason populated?).
 *
 * Read-only by design — the audit is a witness, not a control plane.
 */

import { prisma } from '@sendero/database';

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
    <main className="mx-auto w-full max-w-screen-xl space-y-8 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp inbox audit</h1>
        <p className="text-sm text-muted-foreground">
          Every inbound webhook delivery and every outbound message we sent. Use this when a
          customer reports a missing reply or a stuck OTP.
        </p>
      </header>

      <section aria-labelledby="inbound-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="inbound-heading" className="text-lg font-medium">
            Inbound webhook deliveries
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.min(webhookEvents.length, PAGE_SIZE)} of newest-first
          </p>
        </div>
        {webhookEvents.length === 0 ? (
          <EmptyState
            title="No inbound deliveries logged yet"
            body="Once Meta forwards a message to your webhook, the row lands here."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>Received</Th>
                  <Th>Verify</Th>
                  <Th>Replay</Th>
                  <Th>Msgs</Th>
                  <Th>Statuses</Th>
                  <Th>Disp.</Th>
                  <Th>Drop·R</Th>
                  <Th>Drop·D</Th>
                  <Th>Duration</Th>
                  <Th>Trace</Th>
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map(ev => (
                  <tr key={ev.id} className="border-t border-border">
                    <Td title={ev.receivedAt.toISOString()}>{formatRelative(ev.receivedAt)}</Td>
                    <Td>
                      <Badge tone={ev.signatureValid ? 'ok' : 'fail'}>
                        {ev.signatureValid ? 'ok' : 'bad'}
                      </Badge>
                    </Td>
                    <Td>
                      {ev.replayWindowOk === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge tone={ev.replayWindowOk ? 'ok' : 'warn'}>
                          {ev.replayWindowOk ? 'ok' : 'stale'}
                        </Badge>
                      )}
                    </Td>
                    <Td>{ev.messageCount}</Td>
                    <Td>{ev.statusUpdateCount}</Td>
                    <Td>{ev.dispatchedCount}</Td>
                    <Td>{ev.droppedReplayCount}</Td>
                    <Td>{ev.droppedDuplicateCount}</Td>
                    <Td>{ev.durationMs == null ? '—' : `${ev.durationMs}ms`}</Td>
                    <Td className="font-mono">{ev.traceId?.slice(0, 8) ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="api-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="api-heading" className="text-lg font-medium">
            Outbound API calls
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.min(apiLogs.length, PAGE_SIZE)} of newest-first · Kapso + Meta
          </p>
        </div>
        {apiLogs.length === 0 ? (
          <EmptyState
            title="No API calls logged yet"
            body="Every Kapso health ping and Meta send (or failed attempt) lands here. Filter by failed-only to triage outages."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>Called</Th>
                  <Th>Target</Th>
                  <Th>Method</Th>
                  <Th>Endpoint</Th>
                  <Th>Status</Th>
                  <Th>Duration</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {apiLogs.map(log => (
                  <tr key={log.id} className="border-t border-border">
                    <Td title={log.calledAt.toISOString()}>{formatRelative(log.calledAt)}</Td>
                    <Td>
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">
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
                    <Td>{`${log.durationMs}ms`}</Td>
                    <Td
                      className="max-w-[260px] truncate text-[11px]"
                      title={log.errorMessage ?? undefined}
                    >
                      {log.errorMessage ? (
                        <span className="text-rose-700">{log.errorMessage}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="outbound-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="outbound-heading" className="text-lg font-medium">
            Outbound messages
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.min(outboundMessages.length, PAGE_SIZE)} of newest-first
          </p>
        </div>
        {outboundMessages.length === 0 ? (
          <EmptyState
            title="No outbound messages logged yet"
            body="Every send through `WhatsAppClient` lands here once an audit hook is wired in."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
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
                {outboundMessages.map(msg => (
                  <tr key={msg.id} className="border-t border-border">
                    <Td title={msg.sentAt.toISOString()}>{formatRelative(msg.sentAt)}</Td>
                    <Td>
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">
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
                      {msg.preview ?? <span className="text-muted-foreground">—</span>}
                    </Td>
                    <Td className="font-mono text-[11px]" title={msg.wamid}>
                      {msg.wamid.slice(-12)}
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
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
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
