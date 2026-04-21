import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import Link from 'next/link';
import { formatDate, formatMicroUsd } from '@/lib/format';
import { InvoiceStatusBadge } from './invoice-status-badge';

type InvoiceRow = {
  id: string;
  number: string;
  kind: string;
  status: string;
  toName: string;
  totalMicro: bigint;
  issuedAt: Date | null;
  createdAt: Date;
};

export function InvoicesTable({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Bill to</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>Issued</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map(invoice => (
          <TableRow key={invoice.id}>
            <TableCell>
              <Link
                href={`/app/billing/invoices/${invoice.id}`}
                className="font-medium hover:underline"
              >
                {invoice.number}
              </Link>
              <div className="text-xs text-muted-foreground">
                {invoice.kind.replaceAll('_', ' ')}
              </div>
            </TableCell>
            <TableCell>{invoice.toName}</TableCell>
            <TableCell>
              <InvoiceStatusBadge status={invoice.status} />
            </TableCell>
            <TableCell>{formatMicroUsd(invoice.totalMicro)}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(invoice.issuedAt ?? invoice.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
