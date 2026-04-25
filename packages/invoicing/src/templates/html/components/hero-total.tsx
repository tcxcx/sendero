// packages/invoicing/src/templates/html/components/hero-total.tsx
//
// Customer-pays total in display-size type, anchored at the top of the
// invoice (Track C3). Matches the hero pattern Booking.com / Hopper /
// Airbnb use on their post-purchase confirmation pages: the dollar
// figure the customer cares about lives ABOVE the fold, before any
// breakdown.
//
// The amount and the "Amount paid" label are static here — there's
// only one money figure in a paid invoice (subtotal === total for
// these). For unpaid invoices we'd swap the label to "Amount due"
// based on `invoice.status`, but the current generate-booking-invoice
// flow always issues with status='paid' so we take the simpler path.

import type { CSSProperties } from 'react';
import type { TemplateProps } from '../../types';

function money(v: string, currency: string, locale: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

const wrapperStyle: CSSProperties = {
  marginTop: 24,
  marginBottom: 32,
  paddingTop: 24,
  paddingBottom: 24,
  borderTop: '1px solid #e9e3da',
  borderBottom: '1px solid #e9e3da',
};

const labelStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  display: 'block',
  marginBottom: 8,
};

const amountStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 36,
  fontWeight: 700,
  color: '#0b0b0b',
  lineHeight: 1.1,
  display: 'block',
  wordBreak: 'break-word',
};

export function HeroTotal({ invoice, template }: TemplateProps) {
  const isPaid = invoice.status === 'paid' || invoice.status === 'sent';
  const label = isPaid ? 'Amount paid' : (template.amount_due_label ?? 'Amount due');
  return (
    <div style={wrapperStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={amountStyle}>{money(invoice.total, invoice.currency, template.locale)}</span>
    </div>
  );
}
