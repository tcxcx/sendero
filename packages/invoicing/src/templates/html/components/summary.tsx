// packages/invoicing/src/templates/html/components/summary.tsx
//
// Mobile-first summary block (Track C3).
//
// Previously: a right-aligned `<div>` with a 240px minimum width that
// blew past the 320px viewport on phones. New layout uses a full-width
// stack so totals always fit. Subtotal / discount / tax / VAT lines
// only render when relevant — for a single-line booking invoice the
// only line you see is the bold total, which matches the hero anchor
// at the top of the document.
//
// The hero total component (see `hero-total.tsx`) renders the same
// number in display-size at the top of the page; this Summary block is
// the formal accounting receipt below.

import type { CSSProperties } from 'react';
import type { TemplateProps } from '../../types';

function money(v: string, currency: string, locale: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '4px 0',
  fontSize: 14,
  gap: 12,
};

const valueStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0b0b0b',
  whiteSpace: 'nowrap',
};

export function Summary({ invoice, template }: TemplateProps) {
  const showDiscount = template.include_discount && Number(invoice.discount) > 0;
  const showTax = template.include_tax && Number(invoice.taxAmount) > 0;
  const showVat = template.include_vat && Number(invoice.vatAmount) > 0;
  // For single-line invoices the subtotal === total, so we hide the
  // subtotal row to keep the receipt minimal. Itemized invoices always
  // show subtotal so corporate buyers can see the math.
  const isItemized = invoice.lineItems.length > 1;

  return (
    <div style={{ width: '100%' }}>
      {isItemized && (
        <div style={rowStyle}>
          <span style={{ color: '#555' }}>{template.subtotal_label}</span>
          <span style={valueStyle}>
            {money(invoice.subtotal, invoice.currency, template.locale)}
          </span>
        </div>
      )}
      {showDiscount && (
        <div style={rowStyle}>
          <span style={{ color: '#555' }}>{template.discount_label}</span>
          <span style={valueStyle}>
            -{money(invoice.discount, invoice.currency, template.locale)}
          </span>
        </div>
      )}
      {showTax && (
        <div style={rowStyle}>
          <span style={{ color: '#555' }}>{template.tax_label}</span>
          <span style={valueStyle}>
            {money(invoice.taxAmount, invoice.currency, template.locale)}
          </span>
        </div>
      )}
      {showVat && (
        <div style={rowStyle}>
          <span style={{ color: '#555' }}>{template.vat_label}</span>
          <span style={valueStyle}>
            {money(invoice.vatAmount, invoice.currency, template.locale)}
          </span>
        </div>
      )}
      <div
        style={{
          ...rowStyle,
          borderTop: '1px solid #e9e3da',
          marginTop: 8,
          paddingTop: 12,
          fontWeight: 600,
        }}
      >
        <span>{template.total_summary_label}</span>
        <span style={{ ...valueStyle, fontWeight: 700 }}>
          {money(invoice.total, invoice.currency, template.locale)}
        </span>
      </div>
    </div>
  );
}
