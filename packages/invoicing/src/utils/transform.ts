import type { Invoice, InvoiceLineItem, Tenant } from '@sendero/database';
import type { TemplateProps, Template } from '../templates/types';
import { defaultTemplate } from './default';
import { microToDecimal } from './number';
import { buildPublicInvoiceUrl } from './public-url';

export function invoiceToTemplateProps(args: {
  invoice: Invoice & { lineItems: InvoiceLineItem[] };
  tenant?: Pick<Tenant, 'brandLogoUrl' | 'brandColors'> | null;
  baseUrl?: string;
}): TemplateProps {
  const tpl: Template = {
    ...defaultTemplate(args.invoice.template as Partial<Template>),
    logo_url: args.tenant?.brandLogoUrl ?? args.invoice.fromLogoUrl ?? '',
  };

  return {
    invoice: {
      id: args.invoice.id,
      number: args.invoice.number,
      status: args.invoice.status,
      issuedAt: args.invoice.issuedAt ?? args.invoice.createdAt,
      dueAt: args.invoice.dueAt,
      from: {
        name: args.invoice.fromName,
        address: args.invoice.fromAddress,
        taxId: args.invoice.fromTaxId,
        logoUrl: tpl.logo_url ?? '',
      },
      to: {
        name: args.invoice.toName,
        email: args.invoice.toEmail,
        address: args.invoice.toAddress,
        taxId: args.invoice.toTaxId,
      },
      currency: args.invoice.currency,
      lineItems: args.invoice.lineItems
        .sort((a, b) => a.position - b.position)
        .map(li => ({
          position: li.position,
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: microToDecimal(li.unitPriceMicro),
          amount: microToDecimal(li.amountMicro),
        })),
      subtotal: microToDecimal(args.invoice.subtotalMicro),
      discount: microToDecimal(args.invoice.discountMicro),
      taxRate: Number(args.invoice.taxRate),
      taxAmount: microToDecimal(args.invoice.taxAmountMicro),
      vatRate: Number(args.invoice.vatRate),
      vatAmount: microToDecimal(args.invoice.vatAmountMicro),
      total: microToDecimal(args.invoice.totalMicro),
    },
    template: tpl,
    publicUrl: buildPublicInvoiceUrl(args.invoice.publicToken, args.baseUrl),
  };
}
