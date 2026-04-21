import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
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
          <p className="text-sm text-muted-foreground">{invoice.kind.replaceAll('_', ' ')}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                  <TableCell className="text-right">
                    {formatMicroUsd(item.unitPriceMicro)}
                  </TableCell>
                  <TableCell className="text-right">{formatMicroUsd(item.amountMicro)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span>{formatMicroUsd(invoice.totalMicro)}</span>
          </div>
          <div className="text-xs text-muted-foreground">Due {formatDate(invoice.dueAt)}</div>
        </div>
      </div>

      {invoice.payments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {invoice.payments.map(payment => (
              <div
                key={payment.id}
                className="flex justify-between border-b border-border py-2 text-sm"
              >
                <span>
                  {payment.method}
                  {payment.txHash ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {payment.txHash.slice(0, 12)}
                    </span>
                  ) : null}
                </span>
                <span>{formatMicroUsd(payment.amountMicro)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="font-medium">{name}</div>
        {email ? <div className="text-sm text-muted-foreground">{email}</div> : null}
        {taxId ? <div className="text-sm text-muted-foreground">Tax ID: {taxId}</div> : null}
      </CardContent>
    </Card>
  );
}

function Amount({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{formatMicroUsd(value)}</span>
    </div>
  );
}
