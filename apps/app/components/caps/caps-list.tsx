import { Button } from '@sendero/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { formatMicroUsd } from '@/lib/format';
import { deleteCapAction } from '@/app/(app)/app/caps/actions';

type CapRow = {
  id: string;
  period: string;
  amountMicroUsdc: bigint;
  hardCap: boolean;
  alertWebhookUrl: string | null;
};

export function CapsList({ caps }: { caps: CapRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Period</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Alert webhook</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {caps.map(cap => (
          <TableRow key={cap.id}>
            <TableCell>{cap.period}</TableCell>
            <TableCell>{formatMicroUsd(cap.amountMicroUsdc)}</TableCell>
            <TableCell>{cap.hardCap ? 'Hard cap' : 'Soft alert'}</TableCell>
            <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
              {cap.alertWebhookUrl ?? '—'}
            </TableCell>
            <TableCell className="text-right">
              <form action={deleteCapAction}>
                <input type="hidden" name="period" value={cap.period} />
                <Button type="submit" variant="ghost" size="sm">
                  Delete
                </Button>
              </form>
            </TableCell>
          </TableRow>
        ))}
        {caps.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-muted-foreground">
              No caps configured.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
