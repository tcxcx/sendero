import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { formatDate, formatMicroUsd } from '@/lib/format';
import { InvoiceStatusBadge } from './invoice-status-badge';
import type { Invoice, InvoiceLineItem, InvoicePayment } from '@sendero/database';

type InvoiceWithChildren = Invoice & {
  lineItems: InvoiceLineItem[];
  payments: InvoicePayment[];
};

export function InvoiceDetailView({ invoice }: { invoice: InvoiceWithChildren }) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-normal">{invoice.number}</h1>
          <p
            className="font-mono uppercase text-muted-foreground"
            style={{
              fontSize: 'var(--label-meta, 0.6875rem)',
              letterSpacing: 'var(--label-meta-tracking, 0.12em)',
            }}
          >
            {invoice.kind.replaceAll('_', ' ')}
          </p>
        </div>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Party title="From" name={invoice.fromName} email={null} taxId={invoice.fromTaxId} />
        <Party
          title="Bill to"
          name={invoice.toName}
          email={invoice.toEmail}
          taxId={invoice.toTaxId}
        />
      </div>

      <Panel title="Line items">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lineItems.map(item => (
              <TableRow key={item.id}>
                <TableCell>{item.description}</TableCell>
                <TableCell className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {Number(item.quantity)}
                </TableCell>
                <TableCell className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMicroUsd(item.unitPriceMicro)}
                </TableCell>
                <TableCell className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMicroUsd(item.amountMicro)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <div className="flex justify-end">
        <div className="flex w-full max-w-sm flex-col gap-2 text-sm">
          <Amount label="Subtotal" value={invoice.subtotalMicro} />
          {invoice.discountMicro > 0n ? (
            <Amount label="Discount" value={-invoice.discountMicro} />
          ) : null}
          {invoice.taxAmountMicro > 0n ? (
            <Amount label="Tax" value={invoice.taxAmountMicro} />
          ) : null}
          {invoice.vatAmountMicro > 0n ? (
            <Amount label="VAT" value={invoice.vatAmountMicro} />
          ) : null}
          <div
            className="mt-1 flex justify-between pt-3 font-semibold"
            style={{ borderTop: 'var(--hairline)' }}
          >
            <span>Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMicroUsd(invoice.totalMicro)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">Due {formatDate(invoice.dueAt)}</div>
        </div>
      </div>

      {invoice.payments.length > 0 ? (
        <Panel title="Payments">
          <div className="flex flex-col">
            {invoice.payments.map((payment, index) => (
              <div
                key={payment.id}
                className="flex justify-between py-3 text-sm"
                style={{
                  borderBottom:
                    index < invoice.payments.length - 1 ? 'var(--hairline-soft)' : undefined,
                }}
              >
                <span>
                  {payment.method}
                  {payment.txHash ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {payment.txHash.slice(0, 12)}
                    </span>
                  ) : null}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMicroUsd(payment.amountMicro)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <h3 className="text-[15px] font-semibold tracking-normal text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Party({
  title,
  name,
  email,
  taxId,
}: {
  title: string;
  name: string;
  email: string | null;
  taxId: string | null;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-5 shadow-[var(--shadow-md)]">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        {title}
      </div>
      <div className="font-medium">{name}</div>
      {email ? <div className="text-sm text-muted-foreground">{email}</div> : null}
      {taxId ? <div className="text-sm text-muted-foreground">Tax ID: {taxId}</div> : null}
    </section>
  );
}

function Amount({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMicroUsd(value)}</span>
    </div>
  );
}
