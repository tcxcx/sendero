// packages/invoicing/src/templates/html/components/line-items.tsx
//
// Mobile-first single-column line-item stack (Track C3).
//
// Replaces the prior 4-column `<table>` layout, which broke under
// 320px viewport widths because every column had a non-zero minimum.
// Customer booking invoices increasingly land on phones, so we render
// each line item as its own row of [description / amount] with the
// quantity inlined into the description sub-line when it differs from 1.
//
// Single-mode invoices (1 line item) suppress the breakdown entirely —
// the hero total at the top of the document already shows what the
// customer needs. Itemized invoices render the full stack so corporate
// buyers can see the cost / management-fee / service-fee breakdown.
//
// Why no table at all (not even a 2-column responsive one):
//   - `<table>` triggers minimum-content widths in some email clients
//     that flat-out ignore CSS media queries.
//   - The new layout uses simple flex rows — every email client and
//     every phone browser handles them.

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
  alignItems: 'flex-start',
  gap: 16,
  padding: '14px 0',
  borderBottom: '1px solid #e9e3da',
};

const descriptionStyle: CSSProperties = {
  fontSize: 14,
  color: '#0b0b0b',
  lineHeight: 1.4,
  flex: 1,
  minWidth: 0,
  wordBreak: 'break-word',
};

const quantityStyle: CSSProperties = {
  fontSize: 12,
  color: '#666',
  marginTop: 2,
};

const amountStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 14,
  color: '#0b0b0b',
  whiteSpace: 'nowrap',
  textAlign: 'right',
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  display: 'block',
  marginBottom: 8,
};

export function LineItems({ invoice, template }: TemplateProps) {
  // Single-mode invoices: the hero total above already covers it.
  // Suppressing the duplicate keeps the customer-facing layout clean —
  // matches the "less is more" UX target for consumer invoices.
  if (invoice.lineItems.length <= 1) return null;

  return (
    <div>
      <span style={sectionLabelStyle}>Breakdown</span>
      {invoice.lineItems.map(li => {
        const showQuantity = li.quantity !== 1;
        return (
          <div key={li.position} style={rowStyle}>
            <div style={descriptionStyle}>
              <div>{li.description}</div>
              {showQuantity ? (
                <div style={quantityStyle}>
                  {li.quantity} × {money(li.unitPrice, invoice.currency, template.locale)}
                </div>
              ) : null}
            </div>
            <div style={amountStyle}>{money(li.amount, invoice.currency, template.locale)}</div>
          </div>
        );
      })}
    </div>
  );
}
