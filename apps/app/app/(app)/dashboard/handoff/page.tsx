import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

interface HandoffRow {
  id: string;
  status: string;
  priority: string;
  source: string;
  title: string;
  summary: string;
  assignee_name: string | null;
  whatsapp_profile_name: string | null;
  whatsapp_phone_number: string | null;
  workflow_execution_id: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  raw_context: unknown;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export default async function HandoffPage() {
  const { tenant } = await requireCurrentTenant();
  const rows = await prisma.$queryRaw<HandoffRow[]>`
    SELECT id, status, priority, source, title, summary, assignee_name,
           whatsapp_profile_name, whatsapp_phone_number, workflow_execution_id,
           slack_channel_id, slack_message_ts, raw_context, created_at, updated_at, closed_at
    FROM support_tickets
    WHERE tenant_id = ${tenant.id}
    ORDER BY created_at DESC
    LIMIT 50
  `;

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
        <h1 className="t-h1">Internal handoff</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Web is the primary human handoff channel. WhatsApp and Slack escalations reconcile here so
          operators can see ownership, status, and the original customer context.
        </p>
      </header>

      {rows.length === 0 ? (
        <section
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '16px' }}
        >
          <div className="t-meta">No handoffs yet</div>
          <p className="t-body ink-70" style={{ marginTop: 8, fontSize: 13 }}>
            When the WhatsApp or Slack agent needs a human decision, the handoff appears here first.
          </p>
        </section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(row => (
            <article
              key={row.id}
              className="sd-card-flat"
              style={{
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                padding: '14px 16px',
                display: 'grid',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div className="t-meta">
                    {row.source} · {row.priority}
                  </div>
                  <h2 className="t-h3" style={{ marginTop: 4 }}>
                    {row.title}
                  </h2>
                </div>
                <span className="sd-pill sd-pill-outline" style={{ fontSize: 10 }}>
                  {row.status}
                </span>
              </div>

              <p className="t-body ink-80" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                {row.summary}
              </p>

              <div
                className="t-mono ink-60"
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  fontSize: 11,
                }}
              >
                <span>{row.id}</span>
                <span>{new Date(row.created_at).toLocaleString()}</span>
                {row.assignee_name ? <span>Owner: {row.assignee_name}</span> : null}
                {row.whatsapp_profile_name ? (
                  <span>WhatsApp: {row.whatsapp_profile_name}</span>
                ) : null}
                {row.slack_channel_id ? <span>Slack: {row.slack_channel_id}</span> : null}
                {row.workflow_execution_id ? (
                  <span>Workflow: {row.workflow_execution_id}</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
