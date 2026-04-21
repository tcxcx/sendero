import { Badge } from '@sendero/ui/badge';

const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  searching: 'secondary',
  awaiting_approval: 'secondary',
  booked: 'default',
  in_progress: 'default',
  completed: 'outline',
  canceled: 'destructive',
  failed: 'destructive',
};

export function TripStatusBadge({ status }: { status: string }) {
  return <Badge variant={variants[status] ?? 'outline'}>{status.replaceAll('_', ' ')}</Badge>;
}
