// packages/invoicing/src/templates/html/index.tsx
import type { TemplateProps } from '../types';
import { HeroTotal } from './components/hero-total';
import { Meta } from './components/meta';
import { LineItems } from './components/line-items';
import { Summary } from './components/summary';
import { Note } from './components/note';
import { QRCode } from './components/qr-code';

/**
 * Compute the QR data URL for an invoice's public link. Exposed so
 * callers can render `<InvoiceHtml>` as JSX directly (letting React
 * escape tenant-controlled fields) instead of piping through the
 * string form + dangerouslySetInnerHTML.
 */
export async function renderInvoiceQrDataUrl(publicUrl: string): Promise<string> {
  const QRCodeUtil = await import('qrcode');
  return QRCodeUtil.default.toDataURL(publicUrl, { width: 144, margin: 1 });
}

export function InvoiceHtml(props: TemplateProps & { qrDataUrl?: string }) {
  // Track C3 layout order (top → bottom):
  //   1. Meta            (logo / from / customer / invoice number / dates)
  //   2. HeroTotal       (display-size customer-pays figure — anchored at top per the
  //                       Booking.com / Hopper / Airbnb confirmation pattern)
  //   3. LineItems       (vertical stack; collapses to nothing for single-line mode
  //                       since the hero already shows the customer total)
  //   4. Summary         (subtotal/tax/discount/total — totals block below)
  //   5. QR + Note       (optional; unchanged)
  //
  // No fixed-width tables anywhere — everything is flex / block so the
  // layout reflows under 320px viewports.
  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Arial, sans-serif',
        color: '#0b0b0b',
        background: '#ffffff',
        maxWidth: 720,
        margin: '0 auto',
        padding: '40px 16px',
      }}
    >
      <Meta {...props} />
      <HeroTotal {...props} />
      <LineItems {...props} />
      {props.invoice.lineItems.length > 1 ? <div style={{ height: 32 }} /> : null}
      <Summary {...props} />
      {props.template.include_qr && props.qrDataUrl ? <QRCode dataUrl={props.qrDataUrl} /> : null}
      <Note {...props} />
    </div>
  );
}

/**
 * Server-side render to a full HTML document string. Uses react-dom/server
 * which is already a transitive dep via Next.js; no new dependency.
 */
export async function renderInvoiceHtml(
  props: TemplateProps & { publicUrl: string }
): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const QRCodeUtil = await import('qrcode');
  const qrDataUrl = props.template.include_qr
    ? await QRCodeUtil.default.toDataURL(props.publicUrl, { width: 144, margin: 1 })
    : '';
  const body = renderToStaticMarkup(<InvoiceHtml {...props} qrDataUrl={qrDataUrl} />);
  // Escape the tenant-controlled invoice.number before interpolating
  // into raw HTML. React would handle this if number were a child, but
  // the doctype/head wrapper is a string template — so an invoice
  // number like `</title><script>alert(1)</script>` would otherwise
  // escape the title and execute in every caller that uses the full
  // document (email, standalone viewer, PDF host pages).
  const titleNumber = escapeHtml(props.invoice.number);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${titleNumber}</title></head><body style="margin:0;padding:0;background:#f5f2ee;">${body}</body></html>`;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, ch =>
    ch === '&'
      ? '&amp;'
      : ch === '<'
        ? '&lt;'
        : ch === '>'
          ? '&gt;'
          : ch === '"'
            ? '&quot;'
            : '&#39;'
  );
}
