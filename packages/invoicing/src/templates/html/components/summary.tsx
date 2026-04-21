// packages/invoicing/src/templates/html/components/summary.tsx
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
  padding: '4px 0',
  fontSize: 14,
};

const valueStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0b0b0b',
};

export function Summary({ invoice, template }: TemplateProps) {
  const showDiscount = template.include_discount && Number(invoice.discount) > 0;
  const showTax = template.include_tax && Number(invoice.taxAmount) > 0;
  const showVat = template.include_vat && Number(invoice.vatAmount) > 0;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '45%', minWidth: 240 }}>
        <div style={rowStyle}>
          <span style={{ color: '#555' }}>{template.subtotal_label}</span>
          <span style={valueStyle}>
            {money(invoice.subtotal, invoice.currency, template.locale)}
          </span>
        </div>
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
    </div>
  );
}
