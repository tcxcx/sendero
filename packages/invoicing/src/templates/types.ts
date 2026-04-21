export interface Template {
  logo_url?: string;
  from_label: string;
  customer_label: string;
  invoice_no_label: string;
  issue_date_label: string;
  due_date_label: string;
  amount_due_label?: string;
  date_format: string;
  payment_label: string;
  note_label: string;
  terms_label?: string;
  description_label: string;
  quantity_label: string;
  price_label: string;
  total_label: string;
  total_summary_label: string;
  tax_label: string;
  vat_label: string;
  tax_rate: number;
  vat_rate: number;
  locale: string;
  timezone: string;
  include_decimals: boolean;
  include_units: boolean;
  include_qr: boolean;
  include_vat: boolean;
  include_tax: boolean;
  title: string;
  subtotal_label: string;
  subtotal: number;
  include_discount: boolean;
  discount_label: string;
}

export interface TemplateProps {
  invoice: {
    id: string;
    number: string;
    status: string;
    issuedAt: Date;
    dueAt: Date | null;
    from: {
      name: string;
      address: unknown;
      taxId: string | null;
      logoUrl: string;
    };
    to: {
      name: string;
      email: string;
      address: unknown;
      taxId: string | null;
    };
    currency: string;
    lineItems: Array<{
      position: number;
      description: string;
      quantity: number;
      unitPrice: string;
      amount: string;
    }>;
    subtotal: string;
    discount: string;
    taxRate: number;
    taxAmount: string;
    vatRate: number;
    vatAmount: string;
    total: string;
  };
  template: Template;
  publicUrl: string;
}
