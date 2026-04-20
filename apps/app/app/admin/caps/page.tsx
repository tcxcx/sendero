/**
 * Admin v2 — cap editor.
 *
 * Lists the current TenantSpendCap rows and exposes a form that calls
 * the `upsertCap` server action. Intended for CFOs wiring their daily
 * / monthly nanopayment budget; hard-cap blocks further calls when
 * hit, soft-cap fires an alert webhook and keeps running.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { formatMicroUsdc } from '@sendero/billing/pricing';
import { upsertCap } from './actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CapsPageProps {
  searchParams: Promise<{ tenantId?: string }>;
}

export default async function CapsPage({ searchParams }: CapsPageProps) {
  const params = await searchParams;
  const tenantId = params.tenantId ?? env.whatsappDefaultTenantId() ?? null;

  if (!tenantId) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Sendero · caps</h1>
        <p style={noteStyle}>
          No tenant selected. Pass <code>?tenantId=&lt;cuid&gt;</code>.
        </p>
      </main>
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { displayName: true, slug: true },
  });
  const caps = await prisma.tenantSpendCap.findMany({
    where: { tenantId },
    orderBy: { period: 'asc' },
  });

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>tenant · {tenant?.slug ?? '—'}</div>
          <h1 style={h1Style}>Spend caps</h1>
        </div>
        <a href={`/admin/spend?tenantId=${tenantId}`} style={linkStyle}>
          View spend →
        </a>
      </header>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Active caps</h2>
        {caps.length === 0 ? (
          <p style={noteStyle}>No caps configured. Add one below.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Amount (USDC)</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Alert webhook</th>
              </tr>
            </thead>
            <tbody>
              {caps.map(cap => (
                <tr key={cap.id}>
                  <td style={tdStyle}>{cap.period}</td>
                  <td style={tdStyle}>${formatMicroUsdc(cap.amountMicroUsdc)}</td>
                  <td style={tdStyle}>{cap.hardCap ? 'hard (blocks)' : 'soft (alerts only)'}</td>
                  <td style={tdStyle}>
                    {cap.alertWebhookUrl ? <code>{cap.alertWebhookUrl}</code> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Add / update cap</h2>
        <form
          action={async (formData: FormData) => {
            'use server';
            await upsertCap({
              tenantId,
              period: (formData.get('period') as 'daily' | 'monthly') ?? 'daily',
              amountUsdc: String(formData.get('amountUsdc') ?? '10'),
              hardCap: formData.get('hardCap') === 'on',
              alertWebhookUrl: (formData.get('alertWebhookUrl') as string | null) || null,
            });
          }}
          style={formStyle}
        >
          <label style={labelStyle}>
            <span>Period</span>
            <select name="period" defaultValue="daily" style={inputStyle}>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label style={labelStyle}>
            <span>Amount (USDC)</span>
            <input
              name="amountUsdc"
              type="text"
              defaultValue="10.00"
              pattern="\d+(\.\d{1,6})?"
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span>
              <input type="checkbox" name="hardCap" defaultChecked /> Hard cap (blocks calls)
            </span>
          </label>
          <label style={labelStyle}>
            <span>Alert webhook (optional, for soft caps)</span>
            <input
              name="alertWebhookUrl"
              type="url"
              placeholder="https://hooks.example.com/cap-breach"
              style={inputStyle}
            />
          </label>
          <button type="submit" style={submitStyle}>
            Save cap
          </button>
        </form>
      </section>
    </main>
  );
}

// ─── styles ───

const rootStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '48px 24px 80px',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
  color: '#111',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  marginBottom: 32,
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  marginBottom: 4,
};
const h1Style: React.CSSProperties = {
  fontSize: 28,
  letterSpacing: '-0.025em',
  margin: 0,
  fontWeight: 500,
};
const h2Style: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#555',
  margin: '24px 0 12px',
};
const linkStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#111',
};
const sectionStyle: React.CSSProperties = { marginBottom: 24 };
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e6e6e6',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#555',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #f0f0f0',
};
const noteStyle: React.CSSProperties = { color: '#8a8a8a', fontSize: 13 };
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  border: '1px solid #e6e6e6',
  padding: 20,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: '#111',
};
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ccc',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
  fontSize: 14,
};
const submitStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: '#111',
  color: '#fff',
  border: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};
