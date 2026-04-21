import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
import { Button } from '@sendero/ui/button';
import Link from 'next/link';

export function StatCard({
  title,
  value,
  description,
  href,
}: {
  title: string;
  value: string;
  description?: string;
  href: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="text-3xl font-semibold tracking-normal">{value}</div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href={href}>View</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
