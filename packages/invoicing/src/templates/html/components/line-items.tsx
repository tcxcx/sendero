// packages/invoicing/src/templates/html/components/line-items.tsx
import type { CSSProperties } from 'react';
import type { TemplateProps } from '../../types';

function money(v: string, currency: string, locale: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

const cellBase: CSSProperties = {
  padding: '12px 8px',
  fontSize: 14,
  borderBottom: '1px solid #e9e3da',
};

const headerCell: CSSProperties = {
  ...cellBase,
  color: '#555',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

export function LineItems({ invoice, template }: TemplateProps) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <thead>
        <tr>
          <th style={{ ...headerCell, textAlign: 'left' }}>
            {template.description_label}
          </th>
          <th style={{ ...headerCell, textAlign: 'right' }}>
            {template.quantity_label}
          </th>
          <th style={{ ...headerCell, textAlign: 'right' }}>
            {template.price_label}
          </th>
          <th style={{ ...headerCell, textAlign: 'right' }}>
            {template.total_label}
          </th>
        </tr>
      </thead>
      <tbody>
        {invoice.lineItems.map((li) => (
          <tr key={li.position}>
            <td style={cellBase}>{li.description}</td>
            <td style={{ ...cellBase, textAlign: 'right' }}>{li.quantity}</td>
            <td
              style={{
                ...cellBase,
                textAlign: 'right',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {money(li.unitPrice, invoice.currency, template.locale)}
            </td>
            <td
              style={{
                ...cellBase,
                textAlign: 'right',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {money(li.amount, invoice.currency, template.locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
