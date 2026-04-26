/**
 * InvoicesGrid — editorial table mirroring `InvListA`.
 *
 * Five-column CSS grid: number · customer · issued · status pill ·
 * amount.  Server-rendered rows; each row is a `<Link>` to the detail
 * page.  Status pill tone derived from `invoice.status` via
 * `toneForStatus()`.
 */

import Link from 'next/link';

import { formatDate, formatMicroUsd } from '@/lib/format';

interface InvoiceRow {
  id: string;
  number: string;
  kind: string;
  status: string;
  toName: string;
  totalMicro: bigint;
  issuedAt: Date | null;
  createdAt: Date;
  bookingTripId: string | null;
}

export function InvoicesGrid({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <div
      className="sd-card-flat"
      style={{
        padding: 0,
        boxShadow: 'var(--shadow-md)',
        background: 'var(--surface-floating)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1.4fr 1fr 1fr 130px',
          padding: '14px 22px',
          borderBottom: '1px solid var(--hairline-color)',
        }}
      >
        {['Invoice', 'Customer · trip', 'Issued', 'Status', 'Amount'].map(h => (
          <div
            key={h}
            className="t-meta"
            style={{ textAlign: h === 'Amount' ? 'right' : undefined }}
          >
            {h}
          </div>
        ))}
      </div>
      {invoices.map((inv, i) => {
        const issued = inv.issuedAt ?? inv.createdAt;
        const { label, tone } = stateForStatus(inv.status);
        const trip = inv.bookingTripId ? `· ${shortTripId(inv.bookingTripId)}` : '';
        return (
          <Link
            key={inv.id}
            href={`/dashboard/billing/invoices/${inv.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1.4fr 1fr 1fr 130px',
              padding: '14px 22px',
              borderBottom:
                i < invoices.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
              alignItems: 'center',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <div className="t-mono" style={{ fontSize: 12 }}>
              {inv.number}
            </div>
            <div>
              <div className="t-body" style={{ fontSize: 13, fontWeight: 500 }}>
                {inv.toName} {trip}
              </div>
              <div className="t-mono ink-60" style={{ fontSize: 10.5, marginTop: 2 }}>
                {inv.kind.replaceAll('_', ' ')}
              </div>
            </div>
            <div className="t-mono ink-70" style={{ fontSize: 12 }}>
              {formatDate(issued)}
            </div>
            <div>
              <span
                className={`sd-pill sd-pill-${tone}`}
                style={{ fontSize: 9, padding: '2px 8px', fontWeight: 700 }}
              >
                {label}
              </span>
            </div>
            <div className="t-num-md" style={{ fontSize: 18, textAlign: 'right' }}>
              {formatMicroUsd(inv.totalMicro)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function stateForStatus(status: string): {
  label: string;
  tone: 'verm' | 'sand' | 'sea' | 'outline';
} {
  switch (status) {
    case 'paid':
      return { label: 'PAID', tone: 'sea' };
    case 'sent':
      return { label: 'SENT', tone: 'sea' };
    case 'viewed':
      return { label: 'VIEWED', tone: 'sea' };
    case 'issued':
      return { label: 'ISSUED', tone: 'sand' };
    case 'overdue':
      return { label: 'OVERDUE', tone: 'verm' };
    case 'void':
      return { label: 'VOID', tone: 'outline' };
    default:
      return { label: status.toUpperCase(), tone: 'outline' };
  }
}

function shortTripId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 8).toUpperCase();
}
