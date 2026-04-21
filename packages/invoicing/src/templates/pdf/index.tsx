// packages/invoicing/src/templates/pdf/index.tsx
import { Document, Font, Page, StyleSheet, View, renderToBuffer } from '@react-pdf/renderer';
import QRCodeUtil from 'qrcode';
import { pdfFontPaths } from '../../fonts-server';
import type { TemplateProps } from '../types';
import { theme } from './theme';
import { Meta } from './components/meta';
import { LineItems } from './components/line-items';
import { Summary } from './components/summary';
import { Note } from './components/note';
import { PaymentDetails } from './components/payment-details';
import { QRCode } from './components/qr-code';

// Register fonts once at module load. Best-effort — react-pdf falls back to
// Helvetica if any registration fails.
try { Font.register({ family: 'Inter', src: pdfFontPaths.inter.regular }); } catch (e) { console.warn('[invoicing/pdf] Inter regular registration:', e); }
try { Font.register({ family: 'Inter-Medium', src: pdfFontPaths.inter.medium }); } catch (e) { console.warn('[invoicing/pdf] Inter medium registration:', e); }
try { Font.register({ family: 'Inter-SemiBold', src: pdfFontPaths.inter.semibold }); } catch (e) { console.warn('[invoicing/pdf] Inter semibold registration:', e); }
try { Font.register({ family: 'Inter-Bold', src: pdfFontPaths.inter.bold }); } catch (e) { console.warn('[invoicing/pdf] Inter bold registration:', e); }
try { Font.register({ family: 'Inter-Italic', src: pdfFontPaths.inter.italic }); } catch (e) { console.warn('[invoicing/pdf] Inter italic registration:', e); }
try { Font.register({ family: 'JetBrainsMono', src: pdfFontPaths.jetbrainsMono.regular }); } catch (e) { console.warn('[invoicing/pdf] JetBrainsMono regular registration:', e); }
try { Font.register({ family: 'JetBrainsMono-Bold', src: pdfFontPaths.jetbrainsMono.bold }); } catch (e) { console.warn('[invoicing/pdf] JetBrainsMono bold registration:', e); }

const styles = StyleSheet.create({
  page: {
    padding: theme.spacing(12),
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
    backgroundColor: '#ffffff',
  },
  sectionSpacer: { height: theme.spacing(8) },
});

type InvoicePdfProps = TemplateProps & { qrDataUrl: string };

/**
 * Document. QR data URL is precomputed by renderInvoicePdfBuffer because
 * @react-pdf/renderer does not support React hooks inside the tree.
 */
export function InvoicePdf({ qrDataUrl, ...props }: InvoicePdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Meta {...props} />
        <View style={styles.sectionSpacer} />
        <LineItems {...props} />
        <View style={styles.sectionSpacer} />
        <Summary {...props} />
        {props.template.include_qr && qrDataUrl ? <QRCode dataUrl={qrDataUrl} /> : null}
        <PaymentDetails {...props} />
        <Note {...props} />
      </Page>
    </Document>
  );
}

/**
 * Render an invoice to a PDF Buffer. Precomputes the QR data URL (if enabled
 * on the template) via `qrcode.toDataURL`, then delegates to
 * `@react-pdf/renderer`'s `renderToBuffer`.
 */
export async function renderInvoicePdfBuffer(props: TemplateProps): Promise<Buffer> {
  const qrDataUrl = props.template.include_qr
    ? await QRCodeUtil.toDataURL(props.publicUrl, { width: 144, margin: 1 })
    : '';
  return await renderToBuffer(<InvoicePdf qrDataUrl={qrDataUrl} {...props} />);
}
