/**
 * InvoiceDetailView — InvDetailA "document" layout.
 *
 *   Single 1fr/320px grid. Left: a card-raised "document" with header,
 *   Bill from / Bill to, line-items table, totals strip. Right: action
 *   rail (Download PDF, optional admin Retry PDF) + Settlement card +
 *   Linked trip card.
 *
 * Settlement state is read from the existing Invoice model: a `paidAt`
 * + an InvoicePayment with `txHash` means the invoice settled on-chain;
 * otherwise we show "Awaiting payment". No new schema required.
 *
 * Buttons are only rendered when there's a real backend behind them.
 * "Send to customer" + "Mark as paid" from the design canvas are not
 * wired (no /api/invoices/[id]/send or .../mark-paid endpoints exist
 * today) so they are intentionally omitted; a follow-up can land them
 * once the API is ready.
 */

import Link from 'next/link';

import type {
  Invoice,
  InvoiceLineItem,
  InvoicePayment,
  Prisma as PrismaTypes,
} from '@sendero/database';

import { stateForStatus } from './invoices-card-grid';
import { formatDate, formatMicroUsd, stringFromJson } from '@/lib/format';

type InvoiceWithChildren = Invoice & {
  lineItems: InvoiceLineItem[];
  payments: InvoicePayment[];
  booking?: {
    tripId: string;
    trip: {
      id: string;
      intent: PrismaTypes.JsonValue;
      traveler: { displayName: string | null; email: string | null } | null;
    } | null;
  } | null;
};

export function InvoiceDetailView({ invoice }: { invoice: InvoiceWithChildren }) {
  const { label, tone } = stateForStatus(invoice.status);
  const lastPayment = invoice.payments[0];
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 32,
        minHeight: 0,
      }}
    >
      {/* LEFT — document */}
      <div
        className="sd-card-raised"
        style={{
          padding: '40px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="t-meta">Invoice</div>
            <div className="t-h1" style={{ marginTop: 6 }}>
              {invoice.number}
            </div>
            <div className="t-body ink-70" style={{ marginTop: 4, fontSize: 13 }}>
              Issued {formatDate(invoice.issuedAt ?? invoice.createdAt)}
              {invoice.dueAt ? ` · due ${formatDate(invoice.dueAt)}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span
              className={`sd-pill sd-pill-${tone}`}
              style={{ fontSize: 9, padding: '3px 10px', fontWeight: 700 }}
            >
              {label}
            </span>
            <span className="t-mono ink-60" style={{ fontSize: 11 }}>
              {invoice.kind.replaceAll('_', ' ')}
            </span>
          </div>
        </div>

        <hr aria-hidden style={hairline} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <Party
            title="Bill from"
            name={invoice.fromName}
            address={addressLines(invoice.fromAddress)}
            taxId={invoice.fromTaxId}
          />
          <Party
            title="Bill to"
            name={invoice.toName}
            address={addressLines(invoice.toAddress)}
            taxId={invoice.toTaxId}
            email={invoice.toEmail}
          />
        </div>

        <hr aria-hidden style={hairlineSoft} />

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="t-meta" style={{ textAlign: 'left', paddingBottom: 10 }}>
                Line
              </th>
              <th className="t-meta" style={{ textAlign: 'right', paddingBottom: 10 }}>
                Qty
              </th>
              <th className="t-meta" style={{ textAlign: 'right', paddingBottom: 10 }}>
                Rate
              </th>
              <th className="t-meta" style={{ textAlign: 'right', paddingBottom: 10 }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map(item => (
              <tr key={item.id} style={{ borderTop: '1px solid var(--hairline-color-soft)' }}>
                <td className="t-body" style={{ padding: '12px 0', fontSize: 13 }}>
                  {item.description}
                </td>
                <td
                  className="t-mono"
                  style={{
                    padding: '12px 0',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 12,
                  }}
                >
                  {Number(item.quantity)}
                </td>
                <td
                  className="t-mono"
                  style={{
                    padding: '12px 0',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 12,
                  }}
                >
                  {formatMicroUsd(item.unitPriceMicro)}
                </td>
                <td
                  className="t-num-md"
                  style={{
                    padding: '12px 0',
                    textAlign: 'right',
                    fontSize: 16,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatMicroUsd(item.amountMicro)}
                </td>
              </tr>
            ))}
            {invoice.lineItems.length === 0 ? (
              <tr style={{ borderTop: '1px solid var(--hairline-color-soft)' }}>
                <td
                  className="t-body ink-60"
                  style={{ padding: '12px 0', fontSize: 13 }}
                  colSpan={4}
                >
                  No line items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ marginLeft: 'auto', width: 280 }}>
          <Row label="Subtotal" value={formatMicroUsd(invoice.subtotalMicro)} />
          {invoice.discountMicro > 0n ? (
            <Row label="Discount" value={`−${formatMicroUsd(invoice.discountMicro)}`} />
          ) : null}
          {invoice.taxAmountMicro > 0n ? (
            <Row label="Tax" value={formatMicroUsd(invoice.taxAmountMicro)} />
          ) : null}
          {invoice.vatAmountMicro > 0n ? (
            <Row label="VAT" value={formatMicroUsd(invoice.vatAmountMicro)} />
          ) : null}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderTop: '1px solid var(--hairline-color)',
            }}
          >
            <span className="t-h3">Total due</span>
            <span className="t-num-md" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
              {formatMicroUsd(invoice.totalMicro)}
            </span>
          </div>
        </div>

        {invoice.payments.length > 0 ? (
          <>
            <hr aria-hidden style={hairlineSoft} />
            <div>
              <div className="t-meta">Payments</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {invoice.payments.map(p => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                    }}
                  >
                    <span className="t-body" style={{ fontSize: 13 }}>
                      {p.method}
                      {p.txHash ? (
                        <span className="t-mono ink-60" style={{ marginLeft: 8, fontSize: 11 }}>
                          {p.txHash.slice(0, 14)}…
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="t-mono"
                      style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMicroUsd(p.amountMicro)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* RIGHT — action rail (slot — filled by detail page wrapper) */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettlementCard invoice={invoice} lastPayment={lastPayment} />
        <LinkedTripCard
          tripId={invoice.booking?.tripId ?? null}
          intent={invoice.booking?.trip?.intent ?? null}
          traveler={invoice.booking?.trip?.traveler ?? null}
        />
      </aside>
    </div>
  );
}

// ── right-rail cards ─────────────────────────────────────────

function SettlementCard({
  invoice,
  lastPayment,
}: {
  invoice: InvoiceWithChildren;
  lastPayment: InvoicePayment | undefined;
}) {
  const isPaid = invoice.status === 'paid' && Boolean(invoice.paidAt);
  const headline = isPaid
    ? 'Settled'
    : invoice.status === 'overdue'
      ? 'Overdue'
      : 'Awaiting payment';
  return (
    <div
      className="sd-card-flat"
      style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
    >
      <div className="t-meta">Settlement</div>
      <div className="t-mono ink-70" style={{ fontSize: 11, marginTop: 8 }}>
        Arc L2 · USDC
      </div>
      <div className="t-h3" style={{ marginTop: 6 }}>
        {headline}
      </div>
      {lastPayment?.txHash ? (
        <div
          className="t-mono ink-60"
          style={{ fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}
        >
          {lastPayment.txHash.slice(0, 22)}…
        </div>
      ) : invoice.dueAt ? (
        <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 6 }}>
          due {formatDate(invoice.dueAt)}
        </div>
      ) : null}
    </div>
  );
}

function LinkedTripCard({
  tripId,
  intent,
  traveler,
}: {
  tripId: string | null;
  intent: PrismaTypes.JsonValue | null;
  traveler: { displayName: string | null; email: string | null } | null;
}) {
  if (!tripId) {
    return (
      <div
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
      >
        <div className="t-meta">Linked trip</div>
        <div className="t-body ink-60" style={{ fontSize: 13, marginTop: 6 }}>
          Standalone invoice — not tied to a trip.
        </div>
      </div>
    );
  }
  const intentObj = intent && typeof intent === 'object' ? (intent as Record<string, unknown>) : {};
  const route = pickRoute(intentObj);
  const dep = typeof intentObj.departureDate === 'string' ? intentObj.departureDate : null;
  const who = traveler?.displayName ?? traveler?.email ?? 'Traveler';
  return (
    <Link
      href={`/dashboard/trips/${tripId}`}
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: '14px 16px',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
      }}
    >
      <div className="t-meta">Linked trip</div>
      <div className="t-body" style={{ fontWeight: 500, fontSize: 13, marginTop: 6 }}>
        {tripId.slice(0, 10).toUpperCase()}
        {route ? ` · ${route}` : ''}
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
        {[who, dep ? formatDate(dep) : null].filter(Boolean).join(' · ')}
      </div>
    </Link>
  );
}

function Party({
  title,
  name,
  address,
  email,
  taxId,
}: {
  title: string;
  name: string;
  address: string[];
  email?: string | null;
  taxId?: string | null;
}) {
  return (
    <div>
      <div className="t-meta">{title}</div>
      <div className="t-body" style={{ marginTop: 6, lineHeight: 1.6, fontSize: 13 }}>
        <div style={{ fontWeight: 500 }}>{name}</div>
        {address.map(line => (
          <div key={line} className="ink-70">
            {line}
          </div>
        ))}
        {taxId ? (
          <div className="t-mono ink-60" style={{ fontSize: 11 }}>
            {taxId}
          </div>
        ) : null}
        {email ? <div className="ink-70">{email}</div> : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
      <span className="t-body ink-70" style={{ fontSize: 13 }}>
        {label}
      </span>
      <span className="t-mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────

const hairline: React.CSSProperties = {
  border: 0,
  height: 1,
  background: 'var(--hairline-color)',
  margin: 0,
};

const hairlineSoft: React.CSSProperties = {
  border: 0,
  height: 1,
  background: 'var(--hairline-color-soft)',
  margin: 0,
};

function addressLines(value: PrismaTypes.JsonValue | null): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const v = value as Record<string, unknown>;
  const parts = [
    v.line1,
    v.line2,
    [v.city, v.region, v.postalCode].filter(Boolean).join(', '),
    v.country,
  ];
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function pickRoute(intent: Record<string, unknown>): string | null {
  const origin = typeof intent.origin === 'string' ? intent.origin : null;
  const dest = typeof intent.destination === 'string' ? intent.destination : null;
  if (origin && dest) return `${origin} → ${dest}`;
  const fallback = stringFromJson(intent as PrismaTypes.JsonValue, 'tripSummary', '');
  return dest ?? origin ?? (fallback || null);
}
