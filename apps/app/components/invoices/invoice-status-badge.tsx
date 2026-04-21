import { Badge } from '@sendero/ui/badge';

const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  issued: 'secondary',
  sent: 'secondary',
  viewed: 'secondary',
  paid: 'default',
  overdue: 'destructive',
  void: 'outline',
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  return <Badge variant={variants[status] ?? 'outline'}>{status}</Badge>;
}
