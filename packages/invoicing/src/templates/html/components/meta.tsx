// packages/invoicing/src/templates/html/components/meta.tsx
import type { CSSProperties } from 'react';
import type { TemplateProps } from '../../types';

const labelStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  display: 'block',
  marginBottom: 4,
};

const valueStyle: CSSProperties = {
  fontSize: 14,
  color: '#0b0b0b',
  display: 'block',
  marginBottom: 12,
};

// Mobile-first: each block claims at least 180px and wraps to its own
// row under 320px viewports rather than squishing into unreadable
// columns. The 0 minWidth is the magic that lets the email client
// reflow without picking a horizontal-scrollbar layout.
const blockStyle: CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
};

export function Meta({ invoice, template }: TemplateProps) {
  const issuedFmt = new Intl.DateTimeFormat(template.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(invoice.issuedAt);
  const dueFmt = invoice.dueAt
    ? new Intl.DateTimeFormat(template.locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(invoice.dueAt)
    : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 24,
        marginBottom: 8,
      }}
    >
      <div style={blockStyle}>
        {invoice.from.logoUrl ? (
          <img
            src={invoice.from.logoUrl}
            alt=""
            style={{ width: 56, height: 56, marginBottom: 12 }}
          />
        ) : null}
        <span style={labelStyle}>{template.from_label}</span>
        <span style={{ ...valueStyle, fontWeight: 600 }}>{invoice.from.name}</span>
        {invoice.from.taxId ? <span style={valueStyle}>{invoice.from.taxId}</span> : null}
      </div>
      <div style={blockStyle}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            margin: '0 0 16px',
            color: '#0b0b0b',
          }}
        >
          {template.title}
        </h1>
        <span style={labelStyle}>{template.invoice_no_label}</span>
        <span
          style={{
            ...valueStyle,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {invoice.number}
        </span>
        <span style={labelStyle}>{template.issue_date_label}</span>
        <span style={valueStyle}>{issuedFmt}</span>
        {dueFmt ? (
          <>
            <span style={labelStyle}>{template.due_date_label}</span>
            <span style={valueStyle}>{dueFmt}</span>
          </>
        ) : null}
      </div>
      <div style={blockStyle}>
        <span style={labelStyle}>{template.customer_label}</span>
        <span style={{ ...valueStyle, fontWeight: 600 }}>{invoice.to.name}</span>
        <span style={valueStyle}>{invoice.to.email}</span>
        {invoice.to.taxId ? <span style={valueStyle}>{invoice.to.taxId}</span> : null}
      </div>
    </div>
  );
}
